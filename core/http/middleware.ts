import { Middleware } from './types'
import { logger } from '../logger/logger'

export const securityHeaders: Middleware = async (_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('X-XSS-Protection', '1; mode=block')
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  res.setHeader('Referrer-Policy', 'no-referrer')
  await next()
}

export const httpsEnforcement: Middleware = async (req, res, next) => {
  // Only enforce HTTPS in production
  if (process.env.NODE_ENV !== 'production') {
    return await next()
  }

  // Check X-Forwarded-Proto header (set by reverse proxy/load balancer)
  const forwardedProto = req.headers['x-forwarded-proto'] as string | undefined
  if (forwardedProto && forwardedProto.toLowerCase() === 'http') {
    // Construct HTTPS URL
    const host = req.headers.host || 'example.com'
    const path = req.url || '/'
    const httpsUrl = `https://${host}${path}`

    // 301 Permanent Redirect
    res.status(301).setHeader('Location', httpsUrl).json({})
    return
  }

  await next()
}

export const cors = (allowedOrigins: string[] = ['*']): Middleware => async (req, res, next) => {
  const origin = req.headers['origin'] ?? ''
  const allowed = allowedOrigins.includes('*') || allowedOrigins.includes(origin)

  if (req.method === 'OPTIONS') {
    // Preflight: only respond with CORS headers if the origin is allowed
    if (allowed) {
      res.setHeader('Access-Control-Allow-Origin', allowedOrigins.includes('*') ? '*' : origin)
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
      res.setHeader('Access-Control-Max-Age', '86400')
      res.status(204).end()
    } else {
      res.status(403).fail('CORS_FORBIDDEN', 'Origin not allowed', 403)
    }
    return
  }

  // For non-preflight requests, attach CORS headers on allowed origins and continue
  if (allowed) {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigins.includes('*') ? '*' : origin)
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  }
  await next()
}

export const requestLogger: Middleware = async (req, res, next) => {
  const start = Date.now()
  logger.info('Request', { requestId: req.requestId, method: req.method, path: req.path })
  await next()
  const durationMs = Date.now() - start
  logger.info('Request', { requestId: req.requestId, method: req.method, path: req.path, statusCode: res.statusCode ?? 0, durationMs })
}
