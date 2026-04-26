import { Middleware } from '../http/types'
import { verify } from './jwt'

// Routes that do not require authentication
const PUBLIC_PATHS = [
  'POST /api/v1/auth/login',
  'POST /api/v1/auth/refresh',
  'GET /api/v1/tracking',  // customer portal — prefix match
]

function isPublic(method: string, path: string): boolean {
  const key = `${method} ${path}`
  return PUBLIC_PATHS.some(p => key.startsWith(p))
}

export const authenticate: Middleware = async (req, res, next) => {
  if (isPublic(req.method, req.path)) { await next(); return }

  const authHeader = req.headers['authorization'] ?? ''
  if (!authHeader.startsWith('Bearer ')) {
    res.status(401).fail('UNAUTHORIZED', 'Missing or invalid Authorization header', 401)
    return
  }

  const token = authHeader.slice(7)
  try {
    const secret = process.env.JWT_SECRET
    if (!secret) throw new Error('JWT_SECRET not configured')
    const payload = verify(token, secret)
    req.userId = payload.sub
    req.orgId = payload.org
    req.userRole = payload.role
    await next()
  } catch (e) {
    res.status(401).fail('UNAUTHORIZED', (e as Error).message, 401)
  }
}
