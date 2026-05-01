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
import { warehousesRouter } from './routes/warehouses'
import { ordersRouter } from './routes/orders'
import { analyticsRouter } from './routes/analytics'
import { fraudRouter } from './routes/fraud'
import { billingRouter } from './routes/billing'
import { jobsRouter } from './routes/jobs'
import { healthRouter } from './routes/health'
import { startScheduler } from '../core/queue/scheduler'
import { migrate } from '../core/db/migrator'
import { logger } from '../core/logger/logger'
import { initWsServer } from './ws-instance'

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

  // Routes — health is public (no auth required)
  server.mount('/api/v1/health', healthRouter())
  server.mount('/api/v1/auth', authRouter())
  server.mount('/api/v1/routes', routesRouter())
  server.mount('/api/v1/shipments', shipmentsRouter())
  server.mount('/api/v1/drivers', driversRouter())
  server.mount('/api/v1/warehouses', warehousesRouter())
  server.mount('/api/v1/orders', ordersRouter())
  server.mount('/api/v1/analytics', analyticsRouter())
  server.mount('/api/v1/fraud', fraudRouter())
  server.mount('/api/v1/billing', billingRouter())
  server.mount('/api/v1/jobs', jobsRouter())

  // Create the underlying http.Server before binding so WebSocket can attach.
  const httpServer = server.initHttpServer()

  // Initialise the WsServer singleton and attach it to the HTTP server.
  const wsServer = initWsServer(process.env.REDIS_URL)
  wsServer.attach(httpServer, (conn, req, rooms) => {
    // Parse room subscription from URL query string: ?room=shipment:abc-123
    const url = new URL(req.url ?? '/', 'http://localhost')
    const room = url.searchParams.get('room')
    if (room) {
      rooms.join(conn, room)
      conn.send(JSON.stringify({ type: 'subscribed', room }))
    }

    conn.on('message', (msg) => {
      if (msg.type !== 'text') return
      try {
        const data = JSON.parse(msg.data) as { action?: string; room?: string }
        if (data.action === 'join' && data.room) {
          rooms.join(conn, data.room)
          conn.send(JSON.stringify({ type: 'subscribed', room: data.room }))
        } else if (data.action === 'leave' && data.room) {
          rooms.leave(conn, data.room)
        }
      } catch {
        // ignore malformed JSON
      }
    })
  })

  // Start recurring job scheduler (distributed lock ensures single-instance execution)
  startScheduler()

  const port = parseInt(process.env.PORT ?? '3000')
  server.listen(port, () => {
    logger.info('PILOTS API ready', { port, env: process.env.NODE_ENV })
  })
}

bootstrap().catch(err => {
  console.error('Bootstrap failed:', err)
  process.exit(1)
})
