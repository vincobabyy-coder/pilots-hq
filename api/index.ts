import { readFileSync } from 'fs'
import { PilotsServer } from '../core/http/server'
import { securityHeaders, cors, requestLogger } from '../core/http/middleware'
import { authenticate } from '../core/auth/middleware'
import { rateLimiter } from './middleware/rate-limiter'
import { tenantContext } from './middleware/tenant'
import { errorHandler } from './middleware/error-handler'
import { authRouter } from './routes/auth'
import { routesRouter } from './routes/routes'
import { shipmentsRouter } from './routes/shipments'
import { driversRouter } from './routes/drivers'
import { migrate } from '../core/db/migrator'
import { logger } from '../core/logger/logger'

// Load .env manually
function loadEnv(): void {
  try {
    const env = readFileSync('.env', 'utf8')
    for (const line of env.split('\n')) {
      const t = line.trim()
      if (!t || t.startsWith('#')) continue
      const eq = t.indexOf('=')
      if (eq === -1) continue
      const k = t.slice(0, eq).trim()
      const val = t.slice(eq + 1).trim()
      if (!process.env[k]) process.env[k] = val
    }
  } catch { /* no .env — use environment */ }
}

async function bootstrap(): Promise<void> {
  loadEnv()

  // Run pending migrations on startup
  await migrate()

  const server = new PilotsServer()

  // Middleware pipeline (order matters)
  server.use(errorHandler)
  server.use(securityHeaders)
  server.use(cors(['*']))
  server.use(requestLogger)
  server.use(authenticate)
  server.use(tenantContext)
  server.use(rateLimiter())

  // Routes
  server.mount('/api/v1/auth', authRouter())
  server.mount('/api/v1/routes', routesRouter())
  server.mount('/api/v1/shipments', shipmentsRouter())
  server.mount('/api/v1/drivers', driversRouter())

  const port = parseInt(process.env.PORT ?? '3000')
  server.listen(port, () => {
    logger.info('PILOTS API ready', { port, env: process.env.NODE_ENV })
  })
}

bootstrap().catch(err => {
  console.error('Bootstrap failed:', err)
  process.exit(1)
})
