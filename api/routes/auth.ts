import { Router } from '../../core/http/router'
import { v } from '../../core/validation/schema'
import { login, refresh, getMe } from '../services/auth.service'

const loginSchema = v.object({
  email: v.string().required().email(),
  password: v.string().required().min(8),
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
      res.status(401).fail('INVALID_TOKEN', (e as Error).message, 401)
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

  return router
}
