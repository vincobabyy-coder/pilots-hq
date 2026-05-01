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
// Window to wait for a pong before counting a miss
const PONG_WAIT_MS = 10_000
// Close connection after this many consecutive missed pings
const MAX_MISSED_PINGS = 3
// RTT threshold above which we recommend polling fallback
const RTT_WARN_MS = 500

interface ConnectionQuality {
  connectedAt:      Date
  lastPingAt?:      Date
  lastPongAt?:      Date
  roundTripMs?:     number
  missedPings:      number
  messagesSent:     number
  messagesReceived: number
}

export class WsServer {
  private connections = new Map<string, WsConnection>()
  // Track when each connection last proved itself alive
  private lastPong = new Map<string, number>()
  // Per-connection quality metadata
  private quality = new Map<string, ConnectionQuality>()
  // Per-connection timer that fires if a pong doesn't arrive within PONG_WAIT_MS
  private pongTimeouts = new Map<string, ReturnType<typeof setTimeout>>()

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
      this.quality.set(conn.id, {
        connectedAt:      new Date(),
        missedPings:      0,
        messagesSent:     0,
        messagesReceived: 0,
      })

      logger.info('WsServer new connection', { connId: conn.id, url: req.url ?? '' })

      conn.on('close', () => {
        this.connections.delete(conn.id)
        this.lastPong.delete(conn.id)
        this.quality.delete(conn.id)
        this._clearPongTimeout(conn.id)
        this.rooms.leaveAll(conn)
        logger.info('WsServer connection closed', { connId: conn.id })
      })

      // Update last-pong timestamp whenever the client sends a pong
      conn.on('pong', () => {
        const now = Date.now()
        this.lastPong.set(conn.id, now)

        const q = this.quality.get(conn.id)
        if (q) {
          const rtt = q.lastPingAt ? now - q.lastPingAt.getTime() : undefined
          q.lastPongAt = new Date(now)
          q.roundTripMs = rtt
          q.missedPings = 0 // reset on successful pong

          // Clear the pending miss timer
          this._clearPongTimeout(conn.id)

          // Warn client if RTT is high
          if (rtt !== undefined && rtt > RTT_WARN_MS) {
            this._sendQualityWarning(conn, rtt, 0)
          }
        }
      })

      // Track inbound messages for quality stats
      conn.on('message', () => {
        const q = this.quality.get(conn.id)
        if (q) q.messagesReceived++
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
      const q = this.quality.get(connectionId)
      if (q) q.messagesSent++
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
  // Quality helpers
  // ---------------------------------------------------------------------------

  private _sendQualityWarning(conn: WsConnection, rttMs: number, missedPings: number): void {
    const payload = JSON.stringify({
      type:           'connection_quality',
      rttMs,
      missedPings,
      recommendation: 'consider-polling-fallback',
    })
    conn.send(payload)
  }

  private _clearPongTimeout(connId: string): void {
    const t = this.pongTimeouts.get(connId)
    if (t !== undefined) {
      clearTimeout(t)
      this.pongTimeouts.delete(connId)
    }
  }

  // ---------------------------------------------------------------------------
  // Heartbeat — RFC 6455 §5.5.2 / §5.5.3
  // ---------------------------------------------------------------------------

  /**
   * Every 30 s: ping all connections.
   * If a connection has not been heard from in 90 s, close and remove it.
   * Also tracks per-connection quality: RTT, missed pings, and issues a
   * polling-fallback recommendation when quality degrades.
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
          this.quality.delete(id)
          this._clearPongTimeout(id)
          this.rooms.leaveAll(conn)
          continue
        }

        // Record when we sent this ping
        const q = this.quality.get(id)
        if (q) {
          q.lastPingAt = new Date(now)
        }

        // Send ping
        conn.ping()

        // Schedule a miss if pong doesn't arrive in PONG_WAIT_MS
        this._clearPongTimeout(id) // cancel any stale timer
        const missTimer = setTimeout(() => {
          const qNow = this.quality.get(id)
          if (!qNow) return

          qNow.missedPings++
          logger.warn('WsServer pong timeout — missed ping', {
            connId: id,
            missedPings: qNow.missedPings,
          })

          // Notify client that quality is degraded
          this._sendQualityWarning(conn, qNow.roundTripMs ?? 0, qNow.missedPings)

          // After 3 consecutive misses, close the connection (code 1001)
          if (qNow.missedPings >= MAX_MISSED_PINGS) {
            logger.warn('WsServer closing connection after 3 missed pings', { connId: id })
            conn.close(1001, 'too many missed pings')
            this.connections.delete(id)
            this.lastPong.delete(id)
            this.quality.delete(id)
            this.pongTimeouts.delete(id)
            this.rooms.leaveAll(conn)
          }
        }, PONG_WAIT_MS)

        if (missTimer.unref) missTimer.unref()
        this.pongTimeouts.set(id, missTimer)
      }
    }, HEARTBEAT_INTERVAL_MS)

    // Don't prevent the process from exiting when the server is otherwise idle
    if (this.heartbeatTimer.unref) {
      this.heartbeatTimer.unref()
    }
  }
}
