import { Duplex } from 'stream'
import { EventEmitter } from 'events'
import * as crypto from 'crypto'
import { logger } from '../logger/logger'

export type WsMessage = { type: 'text'; data: string } | { type: 'binary'; data: Buffer }

export class WsConnection extends EventEmitter {
  readonly id: string
  // net.Socket extends stream.Duplex; the http upgrade event hands us a Duplex
  private socket: Duplex
  private alive: boolean = true
  private buffer: Buffer = Buffer.alloc(0)

  constructor(socket: Duplex) {
    super()
    this.id = crypto.randomUUID()
    this.socket = socket

    socket.on('data', (chunk: Buffer) => {
      // Accumulate incoming bytes
      this.buffer = Buffer.concat([this.buffer, chunk])
      this.parseFrames()
    })

    socket.on('error', (err: Error) => {
      logger.warn('WsConnection socket error', { connId: this.id, err: err.message })
      this.emit('error', err)
    })

    socket.on('close', () => {
      this.alive = false
      this.emit('close')
    })

    socket.on('end', () => {
      this.alive = false
      this.emit('close')
    })
  }

  // ---------------------------------------------------------------------------
  // Frame parsing — RFC 6455 §5
  // ---------------------------------------------------------------------------
  private parseFrames(): void {
    // Keep consuming frames from the buffer until we run out of data
    while (true) {
      // Minimum frame header is 2 bytes
      if (this.buffer.length < 2) break

      const byte0 = this.buffer[0]
      const byte1 = this.buffer[1]

      const opcode = byte0 & 0x0f
      const masked = (byte1 & 0x80) !== 0
      let payloadLen = byte1 & 0x7f

      let headerLen = 2 // byte0 + byte1

      if (payloadLen === 126) {
        // Next 2 bytes hold the real length (uint16 BE)
        if (this.buffer.length < 4) break // need more data
        payloadLen = this.buffer.readUInt16BE(2)
        headerLen += 2
      } else if (payloadLen === 127) {
        // Next 8 bytes hold the real length (uint64 BE)
        if (this.buffer.length < 10) break
        // We use Number() — safe for payloads under 2GB (2^31 bytes)
        const high = this.buffer.readUInt32BE(2)
        const low = this.buffer.readUInt32BE(6)
        payloadLen = high * 0x100000000 + low
        headerLen += 8
      }

      if (masked) {
        headerLen += 4 // masking key
      }

      const totalLen = headerLen + payloadLen

      // Wait until the full frame has arrived
      if (this.buffer.length < totalLen) break

      // Extract and unmask payload
      let payload: Buffer
      if (masked) {
        const maskStart = headerLen - 4
        const maskKey = this.buffer.slice(maskStart, maskStart + 4)
        const rawPayload = this.buffer.slice(headerLen, totalLen)
        payload = Buffer.allocUnsafe(payloadLen)
        for (let i = 0; i < payloadLen; i++) {
          payload[i] = rawPayload[i] ^ maskKey[i % 4]
        }
      } else {
        payload = this.buffer.slice(headerLen, totalLen)
      }

      // Consume the frame from the buffer
      this.buffer = this.buffer.slice(totalLen)

      // Dispatch by opcode
      switch (opcode) {
        case 0x1: // text frame
          this.emit('message', { type: 'text', data: payload.toString('utf8') } as WsMessage)
          break

        case 0x2: // binary frame
          this.emit('message', { type: 'binary', data: payload } as WsMessage)
          break

        case 0x8: // connection close
          this.emit('close')
          this.close()
          return // stop processing after close

        case 0x9: // ping — respond with pong carrying the same payload
          this.sendFrame(0xa, payload)
          break

        case 0xa: // pong — mark connection as alive
          this.alive = true
          break

        default:
          logger.warn('WsConnection received unknown opcode', { connId: this.id, opcode })
          break
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Frame building — RFC 6455 §5.2, server frames are never masked
  // ---------------------------------------------------------------------------
  private sendFrame(opcode: number, payload: Buffer): void {
    if (!this.socket.writable) return

    const len = payload.length
    let header: Buffer

    if (len < 126) {
      header = Buffer.allocUnsafe(2)
      header[0] = 0x80 | opcode // FIN=1
      header[1] = len
    } else if (len < 65536) {
      header = Buffer.allocUnsafe(4)
      header[0] = 0x80 | opcode
      header[1] = 126
      header.writeUInt16BE(len, 2)
    } else {
      header = Buffer.allocUnsafe(10)
      header[0] = 0x80 | opcode
      header[1] = 127
      // Write length as BigInt to get the full 8 bytes
      header.writeBigUInt64BE(BigInt(len), 2)
    }

    try {
      this.socket.write(Buffer.concat([header, payload]))
    } catch (err) {
      logger.warn('WsConnection failed to write frame', {
        connId: this.id,
        err: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Send a UTF-8 text message to this client */
  send(message: string): void {
    this.sendFrame(0x1, Buffer.from(message, 'utf8'))
  }

  /** Send a ping frame (opcode 0x9) */
  ping(): void {
    this.sendFrame(0x9, Buffer.alloc(0))
  }

  /** Close the connection gracefully with an optional status code and reason */
  close(code: number = 1000, reason: string = ''): void {
    if (!this.socket.writable) return

    // Build close frame payload: 2-byte status code + optional UTF-8 reason
    const reasonBuf = Buffer.from(reason, 'utf8')
    const payload = Buffer.allocUnsafe(2 + reasonBuf.length)
    payload.writeUInt16BE(code, 0)
    reasonBuf.copy(payload, 2)

    this.sendFrame(0x8, payload)
    this.alive = false
    this.socket.end()
  }

  /** Whether the connection is still considered open */
  get isAlive(): boolean {
    return this.alive
  }
}
