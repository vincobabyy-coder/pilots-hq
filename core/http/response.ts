import { ServerResponse } from 'http'
import { PilotsResponse } from './types'
import { ActionableError } from './errors'

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

    respondError(error: ActionableError) {
      statusCode = error.httpStatus
      const errorBody: Record<string, unknown> = {
        code: error.code,
        severity: error.severity,
        message: error.userMessage,
        technicalMessage: error.technicalMessage,
        telemetryId: error.telemetryId,
      }
      if (error.fields !== undefined) errorBody.fields = error.fields
      if (error.suggestedActions !== undefined) errorBody.suggestedActions = error.suggestedActions
      if (error.docsPath !== undefined) errorBody.docsPath = error.docsPath
      res.json({
        success: false,
        error: errorBody,
      })
    },

    end() {
      if (!headersSent) { headersSent = true; raw.end() }
    }
  }

  return res
}
