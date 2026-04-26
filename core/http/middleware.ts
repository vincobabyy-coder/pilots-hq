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

export const cors = (allowedOrigins: string[] = ['*']): Middleware => async (req, res, next) => {
  const origin = req.headers['origin'] ?? ''
  const allowed = allowedOrigins.includes('*') || allowedOrigins.includes(origin)
  if (allowed) {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigins.includes('*') ? '*' : origin)
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    res.setHeader('Access-Control-Max-Age', '86400')
  }
  if (req.method === 'OPTIONS') { res.status(204).end(); return }
  await next()
}

export const requestLogger: Middleware = async (req, res, next) => {
  const start = Date.now()
  await next()
  logger.info('request', {
    requestId: req.requestId,
    method: req.method,
    path: req.path,
    ms: Date.now() - start,
    orgId: req.orgId,
  })
}
