import { Router } from '../../core/http/router'
import { v } from '../../core/validation/schema'
import { login, refresh, getMe } from '../services/auth.service'
import { decodeToken, TokenExpiredError, JsonWebTokenError, blacklistToken } from '../../core/auth/jwt'

const loginSchema = v.object({
  email: v.string().required().email(),
  password: v.string().required().min(1),
})

const refreshSchema = v.object({
  refreshToken: v.string().required(),
})

export function authRouter(): Router {
  const router = new Router()

  router.post('/login', async (req, res) => {
    const body = req.body as Record<string, unknown>
    const result = loginSchema.parse(body)
    if (!result.ok) { res.status(400).fail('VALIDATION_ERROR', 'Invalid input', 400, result.errors); return }

    try {
      const tokens = await login(result.data.email as string, result.data.password as string)
      res.ok(tokens)
    } catch (e) {
      res.status(401).fail('INVALID_CREDENTIALS', (e as Error).message, 401)
    }
  })

  router.post('/refresh', async (req, res) => {
    const body = req.body as Record<string, unknown>
    const result = refreshSchema.parse(body)
    if (!result.ok) { res.status(400).fail('VALIDATION_ERROR', 'Invalid input', 400, result.errors); return }

    try {
      const tokens = await refresh(result.data.refreshToken as string)
      res.ok(tokens)
    } catch (e) {
      if (e instanceof TokenExpiredError) {
        res.status(401).json({
          error: {
            code: 'REFRESH_TOKEN_EXPIRED',
            message: 'Refresh token expired — please log in again',
            retryable: false,
          },
        })
      } else if (e instanceof JsonWebTokenError) {
        res.status(401).json({
          error: {
            code: 'REFRESH_TOKEN_INVALID',
            message: 'Refresh token is invalid',
            retryable: false,
          },
        })
      } else {
        // User not found or other service error
        res.status(401).json({
          error: {
            code: 'REFRESH_TOKEN_INVALID',
            message: (e as Error).message,
            retryable: false,
          },
        })
      }
    }
  })

  router.get('/me', async (req, res) => {
    if (!req.userId) { res.status(401).fail('UNAUTHORIZED', 'Not authenticated', 401); return }
    try {
      const user = await getMe(req.userId)
      res.ok(user)
    } catch (e) {
      res.status(404).fail('NOT_FOUND', (e as Error).message, 404)
    }
  })

  // Token introspection — returns claims embedded in the current access token.
  // The authenticate middleware has already verified the signature and expiry,
  // so we use decodeToken here (no re-verify) to extract the payload claims.
  router.get('/me/token', async (req, res) => {
    if (!req.userId) { res.status(401).fail('UNAUTHORIZED', 'Not authenticated', 401); return }

    const authHeader = req.headers['authorization'] ?? ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''

    if (!token) {
      res.status(401).fail('UNAUTHORIZED', 'Not authenticated', 401)
      return
    }

    const payload = decodeToken(token)
    if (!payload) {
      res.status(401).fail('UNAUTHORIZED', 'Not authenticated', 401)
      return
    }

    const issuedAt = new Date(payload.iat * 1000).toISOString()
    const expiresAt = new Date(payload.exp * 1000).toISOString()
    const ttlSeconds = Math.max(0, Math.floor((payload.exp * 1000 - Date.now()) / 1000))

    res.ok({
      tokenType: 'access',
      issuedAt,
      expiresAt,
      orgId: payload.org,
      userId: payload.sub,
      tier: payload.role,
      ttlSeconds,
    })
  })

  router.post('/logout', async (req, res) => {
    if (!req.userId) { res.status(401).fail('UNAUTHORIZED', 'Not authenticated', 401); return }

    const authHeader = req.headers['authorization'] ?? ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''

    if (!token) {
      res.status(401).fail('UNAUTHORIZED', 'Not authenticated', 401)
      return
    }

    try {
      await blacklistToken(token)
      res.ok({ loggedOut: true })
    } catch (e) {
      res.status(500).fail('LOGOUT_FAILED', 'Failed to log out', 500)
    }
  })

  return router
}
