import { ServerResponse } from 'http'
import { PilotsResponse } from './types'

export function buildResponse(raw: ServerResponse, requestId: string): PilotsResponse {
  let statusCode = 200
  let headersSent = false

  const res: PilotsResponse = {
    status(code) {
      statusCode = code
      return res
    },

    setHeader(name, value) {
      raw.setHeader(name, value)
      return res
    },

    json(data) {
      if (headersSent) return
      headersSent = true
      const body = JSON.stringify(data)
      raw.writeHead(statusCode, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      })
      raw.end(body)
    },

    ok(data, meta = {}) {
      res.json({
        success: true,
        data,
        meta: { requestId, timestamp: new Date().toISOString(), ...meta }
      })
    },

    fail(code, message, httpStatus = 400, fields = []) {
      statusCode = httpStatus
      res.json({
        success: false,
        error: { code, message, fields },
        meta: { requestId, timestamp: new Date().toISOString() }
      })
    },

    end() {
      if (!headersSent) { headersSent = true; raw.end() }
    }
  }

  return res
}
