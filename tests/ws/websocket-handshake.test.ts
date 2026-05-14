import { describe, it, expect } from '../runner'
import * as http from 'http'
import * as net from 'net'
import * as crypto from 'crypto'
import { WsServer } from '../../core/ws/server'
import { WsConnection } from '../../core/ws/connection'
import { sign } from '../../core/auth/jwt'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a masked client-to-server WebSocket text frame (RFC 6455 §5.2) */
function buildClientFrame(text: string): Buffer {
  const payload = Buffer.from(text, 'utf8')
  const mask = crypto.randomBytes(4)
  const masked = Buffer.alloc(payload.length)
  for (let i = 0; i < payload.length; i++) {
    masked[i] = payload[i] ^ mask[i % 4]
  }
  // 2-byte header + 4-byte mask + masked payload (assumes payload.length < 126)
  const frame = Buffer.alloc(6 + payload.length)
  frame[0] = 0x81                    // FIN=1, opcode=text
  frame[1] = 0x80 | payload.length   // MASK=1, 7-bit length
  mask.copy(frame, 2)
  masked.copy(frame, 6)
  return frame
}

/**
 * Open a raw TCP socket, send the RFC 6455 upgrade request, and collect all
 * bytes until the server's "101\r\n\r\n" response is complete.
 * Returns the socket (still open) and the raw response text.
 */
function rawHandshake(
  port: number,
  key: string,
  token?: string
): Promise<{ socket: net.Socket; responseText: string }> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1')
    let buf = ''

    socket.setEncoding('utf8')

    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error('Handshake timeout'))
    }, 5000)

    socket.once('connect', () => {
      const path = token ? `/?token=${encodeURIComponent(token)}` : '/'
      socket.write(
        `GET ${path} HTTP/1.1\r\n` +
        'Host: localhost\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Key: ${key}\r\n` +
        'Sec-WebSocket-Version: 13\r\n' +
        '\r\n'
      )
    })

    const onData = (chunk: string) => {
      buf += chunk
      // The 101 response ends with \r\n\r\n
      if (buf.includes('\r\n\r\n')) {
        clearTimeout(timer)
        socket.setEncoding('binary') // switch back for binary frames
        socket.removeListener('data', onData)
        resolve({ socket, responseText: buf })
      }
    }

    socket.on('data', onData)
    socket.once('error', (err) => { clearTimeout(timer); reject(err) })
  })
}

/** Spin up an http.Server + WsServer on an OS-assigned port */
function createTestServer(
  handler: (conn: WsConnection) => void
): Promise<{ httpServer: http.Server; port: number; closeFn: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const httpServer = http.createServer()
    const wsServer = new WsServer() // no Redis — unit test

    // Track every server-side socket so we can destroy them on teardown
    const serverSockets = new Set<net.Socket>()
    httpServer.on('connection', (s: net.Socket) => {
      serverSockets.add(s)
      s.once('close', () => serverSockets.delete(s))
    })

    wsServer.attach(httpServer, (conn) => handler(conn))

    const closeFn = (): Promise<void> =>
      new Promise((res) => {
        // Force-destroy all tracked server-side sockets
        for (const s of serverSockets) s.destroy()
        serverSockets.clear()
        httpServer.close(() => res())
      })

    httpServer.listen(0, '127.0.0.1', () => {
      const addr = httpServer.address() as net.AddressInfo
      resolve({ httpServer, port: addr.port, closeFn })
    })

    httpServer.once('error', reject)
  })
}

// ---------------------------------------------------------------------------
// Helpers for JWT token generation
// ---------------------------------------------------------------------------

/** Generate a test JWT token if JWT_SECRET is configured */
function getTestToken(): string | undefined {
  const jwtSecret = process.env.JWT_SECRET
  if (!jwtSecret) return undefined

  return sign(
    {
      sub: 'test-user-id',
      org: 'test-org-id',
      role: 'admin',
    },
    jwtSecret,
    3600 // 1 hour
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WebSocket handshake', () => {
  it('WebSocket handshake returns 101 Switching Protocols', async () => {
    const { port, closeFn } = await createTestServer(() => { /* no-op */ })
    const key = crypto.randomBytes(16).toString('base64')
    const token = getTestToken()
    let socket: net.Socket | undefined

    try {
      const { socket: s, responseText } = await rawHandshake(port, key, token)
      socket = s

      const has101 = responseText.includes('101')
      expect(has101).toBeTruthy()

      const hasAccept = responseText.includes('Sec-WebSocket-Accept')
      expect(hasAccept).toBeTruthy()
    } finally {
      socket?.destroy()
      await closeFn()
    }
  })

  it('server echoes text frame back', async () => {
    const { port, closeFn } = await createTestServer((conn) => {
      conn.on('message', (m) => {
        if (m.type === 'text') conn.send(m.data)
      })
    })

    const key = crypto.randomBytes(16).toString('base64')
    const token = getTestToken()
    let socket: net.Socket | undefined

    try {
      const { socket: s } = await rawHandshake(port, key, token)
      socket = s

      // Send the client text frame
      socket.write(buildClientFrame('hello'))

      // Collect raw bytes until we have a complete server text frame
      const echoBytes = await new Promise<Buffer>((resolve, reject) => {
        let raw = Buffer.alloc(0)
        const timer = setTimeout(() => reject(new Error('echo timeout')), 5000)

        const onData = (chunk: Buffer | string) => {
          // socket encoding is 'binary' after rawHandshake; convert string → Buffer
          const buf =
            typeof chunk === 'string'
              ? Buffer.from(chunk, 'binary')
              : chunk
          raw = Buffer.concat([raw, buf])

          // Server frame: byte[0]=0x81 (FIN+text), byte[1]=unmasked len
          if (raw.length >= 2) {
            const payloadLen = raw[1] & 0x7f
            if (raw.length >= 2 + payloadLen) {
              clearTimeout(timer)
              socket!.removeListener('data', onData)
              resolve(raw)
            }
          }
        }

        socket!.on('data', onData)
        socket!.once('error', (err) => { clearTimeout(timer); reject(err) })
      })

      // Parse: skip 2-byte header, read payload
      const payloadLen = echoBytes[1] & 0x7f
      const text = echoBytes.slice(2, 2 + payloadLen).toString('utf8')
      expect(text).toBe('hello')
    } finally {
      socket?.destroy()
      await closeFn()
    }
  })
})

describe('WebSocket rejection', () => {
  it('non-WebSocket upgrade is rejected with 400', async () => {
    // Send an Upgrade: websocket request WITHOUT Sec-WebSocket-Key.
    // WsServer checks for the key and responds with 400 Bad Request then destroys the socket.
    const { port, closeFn } = await createTestServer(() => { /* no-op */ })
    const socket = net.connect(port, '127.0.0.1')

    try {
      const responseText = await new Promise<string>((resolve, reject) => {
        let buf = ''
        const timer = setTimeout(() => reject(new Error('rejection timeout')), 5000)

        socket.setEncoding('utf8')
        socket.once('connect', () => {
          // Upgrade request missing Sec-WebSocket-Key → server sends 400 + destroys
          socket.write(
            'GET / HTTP/1.1\r\n' +
            'Host: localhost\r\n' +
            'Upgrade: websocket\r\n' +
            'Connection: Upgrade\r\n' +
            '\r\n'
          )
        })

        socket.on('data', (chunk: string) => {
          buf += chunk
          if (buf.length > 0) {
            clearTimeout(timer)
            resolve(buf)
          }
        })

        // Server destroys socket after 400 — close fires if data event missed
        socket.once('close', () => {
          clearTimeout(timer)
          resolve(buf || 'connection closed')
        })

        socket.once('error', () => {
          clearTimeout(timer)
          resolve(buf || 'connection closed')
        })
      })

      // Must be a 400, not a 101
      const isRejected = responseText.includes('400') || responseText === 'connection closed'
      expect(isRejected).toBeTruthy()
    } finally {
      socket.destroy()
      await closeFn()
    }
  })
})
