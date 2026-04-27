import * as http from 'http'
import * as crypto from 'crypto'
import { WsConnection } from './connection'
import { RoomManager } from './rooms'
import { logger } from '../logger/logger'

export type UpgradeHandler = (
  conn: WsConnection,
  req: http.IncomingMessage,
  rooms: RoomManager
) => void

// Milliseconds between heartbeat pings
const HEARTBEAT_INTERVAL_MS = 30_000
// If a connection has not responded within this window, close it
const HEARTBEAT_TIMEOUT_MS = 90_000

export class WsServer {
  private connections = new Map<string, WsConnection>()
  // Track when each connection last proved itself alive
  private lastPong = new Map<string, number>()
  readonly rooms: RoomManager

  private heartbeatTimer: ReturnType<typeof setInterval> | null = null

  constructor(redisUrl?: string) {
    this.rooms = new RoomManager(redisUrl)
  }

  // ---------------------------------------------------------------------------
  // Attach to an existing http.Server
  // ---------------------------------------------------------------------------

  /**
   * Listen for the HTTP 'upgrade' event on httpServer.
   * Performs the RFC 6455 handshake, creates a WsConnection, and invokes handler.
   */
  attach(httpServer: http.Server, handler: UpgradeHandler): void {
    httpServer.on('upgrade', (req: http.IncomingMessage, socket, _head: Buffer) => {
      const key = req.headers['sec-websocket-key'] as string | undefined
      const upgradeHeader = req.headers['upgrade']

      if (!key || upgradeHeader?.toLowerCase() !== 'websocket') {
        socket.write('HTTP/1.1 400 Bad Request\r\n\r\n')
        socket.destroy()
        logger.warn('WsServer rejected non-WebSocket upgrade request', {
          url: req.url ?? '',
          upgrade: upgradeHeader ?? '',
        })
        return
      }

      // RFC 6455 §4.2.2 — compute Sec-WebSocket-Accept
      const accept = crypto
        .createHash('sha1')
        .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
        .digest('base64')

      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\n' +
          'Upgrade: websocket\r\n' +
          'Connection: Upgrade\r\n' +
          `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
      )

      const conn = new WsConnection(socket)

      this.connections.set(conn.id, conn)
      this.lastPong.set(conn.id, Date.now())

      logger.info('WsServer new connection', { connId: conn.id, url: req.url ?? '' })

      conn.on('close', () => {
        this.connections.delete(conn.id)
        this.lastPong.delete(conn.id)
        this.rooms.leaveAll(conn)
        logger.info('WsServer connection closed', { connId: conn.id })
      })

      // Update last-pong timestamp whenever the client sends a pong
      // (WsConnection emits 'message' for data frames; pongs update conn.isAlive internally,
      // but we also refresh our timestamp map here via a dedicated hook)
      conn.on('pong', () => {
        this.lastPong.set(conn.id, Date.now())
      })

      handler(conn, req, this.rooms)
    })

    this.startHeartbeat()

    logger.info('WsServer attached to HTTP server')
  }

  // ---------------------------------------------------------------------------
  // Targeted messaging
  // ---------------------------------------------------------------------------

  /** Send a message to a specific connection by its UUID */
  sendTo(connectionId: string, message: string): void {
    const conn = this.connections.get(connectionId)
    if (conn && conn.isAlive) {
      conn.send(message)
    } else {
      logger.warn('WsServer.sendTo — connection not found or dead', { connectionId })
    }
  }

  /** Broadcast a message to all connections in a room (local only; use rooms.publish for cross-instance) */
  broadcastToRoom(roomName: string, message: string): void {
    this.rooms.broadcast(roomName, message)
  }

  /** Number of currently tracked connections */
  get connectionCount(): number {
    return this.connections.size
  }

  // ---------------------------------------------------------------------------
  // Heartbeat — RFC 6455 §5.5.2 / §5.5.3
  // ---------------------------------------------------------------------------

  /**
   * Every 30 s: ping all connections.
   * If a connection has not been heard from in 90 s, close and remove it.
   *
   * Note: WsConnection internally marks itself alive on pong receipt (isAlive flag).
   * We additionally maintain lastPong timestamps so we can enforce the 90-second window
   * irrespective of how many ping/pong cycles the client may have missed.
   */
  private startHeartbeat(): void {
    if (this.heartbeatTimer !== null) return

    this.heartbeatTimer = setInterval(() => {
      const now = Date.now()

      for (const [id, conn] of this.connections) {
        const last = this.lastPong.get(id) ?? 0
        const elapsed = now - last

        if (elapsed > HEARTBEAT_TIMEOUT_MS) {
          // No sign of life for 90 s — terminate
          logger.warn('WsServer heartbeat timeout — closing dead connection', {
            connId: id,
            elapsedMs: elapsed,
          })
          conn.close(1001, 'heartbeat timeout')
          this.connections.delete(id)
          this.lastPong.delete(id)
          this.rooms.leaveAll(conn)
          continue
        }

        // Send a ping; when the pong arrives WsConnection emits 'pong' (if registered)
        // and also sets isAlive = true internally.
        conn.ping()
      }
    }, HEARTBEAT_INTERVAL_MS)

    // Don't prevent the process from exiting when the server is otherwise idle
    if (this.heartbeatTimer.unref) {
      this.heartbeatTimer.unref()
    }
  }
}
