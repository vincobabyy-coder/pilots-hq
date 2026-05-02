// tests/integration/helpers/server.ts
// Starts a PilotsServer on a random port for integration tests.
// Each test file calls startTestServer() once and stopTestServer() after.

import { readFileSync } from 'fs'
import * as http from 'http'
import { PilotsServer } from '../../../core/http/server'
import { securityHeaders, cors, requestLogger } from '../../../core/http/middleware'
import { authenticate } from '../../../core/auth/middleware'
import { rateLimiter } from '../.././../api/middleware/rate-limiter'
import { tenantContext } from '../../../api/middleware/tenant'
import { errorHandler } from '../../../api/middleware/error-handler'
import { migrate } from '../../../core/db/migrator'
import { healthRouter } from '../../../api/routes/health'
import { authRouter } from '../../../api/routes/auth'
import { warehousesRouter } from '../../../api/routes/warehouses'
import { ordersRouter } from '../../../api/routes/orders'
import { shipmentsRouter } from '../../../api/routes/shipments'
import { analyticsRouter } from '../../../api/routes/analytics'
import { fraudRouter } from '../../../api/routes/fraud'
import { billingRouter } from '../../../api/routes/billing'
import { jobsRouter } from '../../../api/routes/jobs'
import { routesRouter } from '../../../api/routes/routes'
import { driversRouter } from '../../../api/routes/drivers'

export function loadEnv(): void {
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

let _server: http.Server | null = null
let _baseUrl = ''

export function baseUrl(): string {
  return _baseUrl
}

export async function startTestServer(): Promise<string> {
  loadEnv()
  await migrate()

  const app = new PilotsServer()
  app.use(errorHandler)
  app.use(securityHeaders)
  app.use(cors(['*']))
  app.use(requestLogger)
  app.use(authenticate)
  app.use(tenantContext)
  app.use(rateLimiter())

  app.mount('/api/v1/health', healthRouter())
  app.mount('/api/v1/auth', authRouter())
  app.mount('/api/v1/warehouses', warehousesRouter())
  app.mount('/api/v1/orders', ordersRouter())
  app.mount('/api/v1/shipments', shipmentsRouter())
  app.mount('/api/v1/analytics', analyticsRouter())
  app.mount('/api/v1/fraud', fraudRouter())
  app.mount('/api/v1/billing', billingRouter())
  app.mount('/api/v1/jobs', jobsRouter())
  app.mount('/api/v1/routes', routesRouter())
  app.mount('/api/v1/drivers', driversRouter())

  const httpServer = app.initHttpServer()

  await new Promise<void>((resolve, reject) => {
    httpServer.listen(0, () => resolve())
    httpServer.once('error', reject)
  })

  const addr = httpServer.address() as { port: number }
  _server = httpServer
  _baseUrl = `http://127.0.0.1:${addr.port}`
  return _baseUrl
}

export async function stopTestServer(): Promise<void> {
  if (!_server) return
  await new Promise<void>((resolve, reject) => {
    _server!.close(err => (err ? reject(err) : resolve()))
  })
  _server = null
  _baseUrl = ''
}

export interface ApiResponse<T = Record<string, unknown>> {
  status: number
  body: T
}

export async function request<T = Record<string, unknown>>(
  method: string,
  path: string,
  options: { body?: unknown; token?: string } = {}
): Promise<ApiResponse<T>> {
  const url = new URL(path, _baseUrl)

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (options.token) {
    headers['Authorization'] = `Bearer ${options.token}`
  }

  const bodyStr = options.body !== undefined ? JSON.stringify(options.body) : undefined
  if (bodyStr) {
    headers['Content-Length'] = String(Buffer.byteLength(bodyStr))
  }

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: url.hostname,
        port: Number(url.port),
        path: url.pathname + url.search,
        method,
        headers,
      },
      (res) => {
        let raw = ''
        res.on('data', (chunk: string) => { raw += chunk })
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode ?? 0, body: JSON.parse(raw) as T })
          } catch {
            resolve({ status: res.statusCode ?? 0, body: {} as T })
          }
        })
      }
    )
    req.on('error', reject)
    if (bodyStr) req.write(bodyStr)
    req.end()
  })
}
