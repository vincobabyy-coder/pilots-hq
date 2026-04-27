import Redis from 'ioredis'
import { WsConnection } from './connection'
import { logger } from '../logger/logger'

export class RoomManager {
  // room name → Set of connection IDs currently in that room (in-process only)
  private rooms: Map<string, Set<string>> = new Map()

  // connection ID → WsConnection (for fast lookup when broadcasting)
  private connections: Map<string, WsConnection> = new Map()

  // connection ID → Set of room names (so leaveAll is O(rooms-per-conn))
  private connRooms: Map<string, Set<string>> = new Map()

  private redisSubscriber: Redis | null = null
  private redisPublisher: Redis | null = null

  constructor(redisUrl?: string) {
    if (redisUrl) {
      this.initRedis(redisUrl)
    }
  }

  private initRedis(redisUrl: string): void {
    try {
      // Subscriber connection — dedicated; cannot be used for publish
      this.redisSubscriber = new Redis(redisUrl, { lazyConnect: true })
      // Publisher connection — used for publish + regular commands
      this.redisPublisher = new Redis(redisUrl, { lazyConnect: true })

      this.redisSubscriber.on('error', (err: Error) => {
        logger.warn('RoomManager Redis subscriber error — falling back to local broadcast', {
          err: err.message,
        })
      })

      this.redisPublisher.on('error', (err: Error) => {
        logger.warn('RoomManager Redis publisher error — falling back to local broadcast', {
          err: err.message,
        })
      })

      // Pattern subscribe to all ws:room:* channels
      this.redisSubscriber.psubscribe('ws:room:*', (err) => {
        if (err) {
          logger.warn('RoomManager psubscribe failed', { err: err.message })
        } else {
          logger.info('RoomManager subscribed to ws:room:* on Redis')
        }
      })

      // When another server instance publishes to a room channel, broadcast locally
      this.redisSubscriber.on(
        'pmessage',
        (_pattern: string, channel: string, message: string) => {
          // channel format: ws:room:{roomName}
          const roomName = channel.replace(/^ws:room:/, '')
          // Broadcast only to local connections (don't re-publish to Redis — avoid loops)
          this.broadcastLocal(roomName, message)
        }
      )
    } catch (err) {
      logger.warn('RoomManager failed to initialise Redis — local-only mode', {
        err: err instanceof Error ? err.message : String(err),
      })
      this.redisSubscriber = null
      this.redisPublisher = null
    }
  }

  // ---------------------------------------------------------------------------
  // Membership management
  // ---------------------------------------------------------------------------

  /** Register a connection so it can be found during broadcasts */
  private register(conn: WsConnection): void {
    if (!this.connections.has(conn.id)) {
      this.connections.set(conn.id, conn)
      this.connRooms.set(conn.id, new Set())
    }
  }

  /** Add a connection to a named room */
  join(conn: WsConnection, roomName: string): void {
    this.register(conn)

    if (!this.rooms.has(roomName)) {
      this.rooms.set(roomName, new Set())
    }

    this.rooms.get(roomName)!.add(conn.id)
    this.connRooms.get(conn.id)!.add(roomName)

    logger.debug('RoomManager join', { connId: conn.id, room: roomName })
  }

  /** Remove a connection from a single room */
  leave(conn: WsConnection, roomName: string): void {
    const room = this.rooms.get(roomName)
    if (room) {
      room.delete(conn.id)
      if (room.size === 0) {
        this.rooms.delete(roomName)
      }
    }

    this.connRooms.get(conn.id)?.delete(roomName)

    logger.debug('RoomManager leave', { connId: conn.id, room: roomName })
  }

  /** Remove a connection from every room it belongs to (call on disconnect) */
  leaveAll(conn: WsConnection): void {
    const memberRooms = this.connRooms.get(conn.id)
    if (memberRooms) {
      for (const roomName of memberRooms) {
        const room = this.rooms.get(roomName)
        if (room) {
          room.delete(conn.id)
          if (room.size === 0) {
            this.rooms.delete(roomName)
          }
        }
      }
    }

    this.connRooms.delete(conn.id)
    this.connections.delete(conn.id)

    logger.debug('RoomManager leaveAll', { connId: conn.id })
  }

  // ---------------------------------------------------------------------------
  // Broadcasting
  // ---------------------------------------------------------------------------

  /** Broadcast a message to all local connections in a room (no Redis) */
  private broadcastLocal(roomName: string, message: string): void {
    const room = this.rooms.get(roomName)
    if (!room || room.size === 0) return

    for (const connId of room) {
      const conn = this.connections.get(connId)
      if (conn && conn.isAlive) {
        conn.send(message)
      }
    }
  }

  /** Broadcast to all local connections in a room (does NOT publish to Redis) */
  broadcast(roomName: string, message: string): void {
    this.broadcastLocal(roomName, message)
  }

  /**
   * Publish a message to a room:
   * - Broadcasts locally to connections on this server instance
   * - Publishes to Redis so other server instances can broadcast their local connections
   *
   * Falls back to local-only if Redis is unavailable.
   */
  publish(roomName: string, message: string): void {
    // Always deliver to local connections immediately
    this.broadcastLocal(roomName, message)

    if (this.redisPublisher) {
      this.redisPublisher
        .publish(`ws:room:${roomName}`, message)
        .catch((err: Error) => {
          logger.warn('RoomManager Redis publish failed — message already delivered locally', {
            room: roomName,
            err: err.message,
          })
        })
    }
  }
}
