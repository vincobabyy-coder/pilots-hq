import { Middleware } from '../http/types'
import { verify, TokenExpiredError, JsonWebTokenError } from './jwt'

// Routes that do not require authentication
const PUBLIC_PATHS = [
  'POST /api/v1/auth/login',
  'POST /api/v1/auth/refresh',
  'GET /api/v1/tracking',  // customer portal — prefix match
  'GET /api/v1/health',
]

function isPublic(method: string, path: string): boolean {
  const key = `${method} ${path}`
  return PUBLIC_PATHS.some(p => key.startsWith(p))
}

export const authenticate: Middleware = async (req, res, next) => {
  if (isPublic(req.method, req.path)) { await next(); return }

  const authHeader = req.headers['authorization'] ?? ''
  if (!authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      error: {
        code: 'TOKEN_MISSING',
        message: 'Authorization header required',
        retryable: false,
      },
    })
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
    if (e instanceof TokenExpiredError) {
      res.status(401).json({
        error: {
          code: 'TOKEN_EXPIRED',
          message: 'Access token expired — use refresh token to obtain a new one',
          retryable: true,
        },
      })
    } else if (e instanceof JsonWebTokenError) {
      res.status(401).json({
        error: {
          code: 'TOKEN_INVALID',
          message: 'Access token is invalid',
          retryable: false,
        },
      })
    } else {
      // Configuration error or other unexpected failure — do not leak internals
      res.status(401).json({
        error: {
          code: 'TOKEN_INVALID',
          message: 'Access token is invalid',
          retryable: false,
        },
      })
    }
  }
}
