// tests/integration/jobs.test.ts
import { describe, it, expect } from '../runner'
import { startTestServer, stopTestServer, request } from './helpers/server'
import { createOrg, createUser, login } from '../../api/services/auth.service'
import { query } from '../../core/db/pool'

describe('Jobs Integration', () => {
  let token = ''
  const UNKNOWN_QUEUE = 'nonexistent-queue-xyz'

  it('starts server and authenticates', async () => {
    await startTestServer()
    const org = await createOrg('Jobs Test Org', `jobs-test-${Date.now()}`)
    const user = await createUser(org.id, `jobs${Date.now()}@example.com`, 'Password123!', 'Jobs Tester', 'admin')
    const rows = await query<{ email: string }>('SELECT email FROM users WHERE id = $1', [user.id])
    const tokens = await login(rows[0].email, 'Password123!')
    token = tokens.accessToken
    expect(typeof token).toBe('string')
  })

  // GET /:queueName/dlq has no auth guard — returns 200 for any caller
  it('GET /api/v1/jobs/:queueName/dlq with auth returns 200 with jobs array', async () => {
    const res = await request('GET', `/api/v1/jobs/${UNKNOWN_QUEUE}/dlq`, { token })
    expect(res.status).toBe(200)
    const data = (res.body as any).data as any
    // Response shape: { jobs: [...], meta: { count, queue } }
    expect(Array.isArray(data.jobs)).toBe(true)
    expect(typeof data.meta).toBe('object')
    expect(data.meta.queue).toBe(UNKNOWN_QUEUE)
  })

  it('GET /api/v1/jobs/:queueName/dlq without auth returns 200 with jobs array', async () => {
    const res = await request('GET', `/api/v1/jobs/${UNKNOWN_QUEUE}/dlq`)
    expect(res.status).toBe(200)
    const data = (res.body as any).data as any
    expect(Array.isArray(data.jobs)).toBe(true)
  })

  it('POST /api/v1/jobs/:queueName/dlq/:jobId/replay without auth returns 401', async () => {
    const res = await request('POST', `/api/v1/jobs/${UNKNOWN_QUEUE}/dlq/00000000-0000-0000-0000-000000000099/replay`)
    expect(res.status).toBe(401)
  })

  it('POST /api/v1/jobs/:queueName/dlq/:jobId/replay with unknown jobId returns 404', async () => {
    const res = await request('POST', `/api/v1/jobs/${UNKNOWN_QUEUE}/dlq/00000000-0000-0000-0000-000000000099/replay`, { token })
    expect(res.status).toBe(404)
  })

  it('GET /api/v1/jobs/:jobId/trace without auth returns 401', async () => {
    const res = await request('GET', '/api/v1/jobs/00000000-0000-0000-0000-000000000099/trace')
    expect(res.status).toBe(401)
  })

  it('GET /api/v1/jobs/:jobId/trace with unknown jobId returns 200 with empty trace', async () => {
    const res = await request('GET', '/api/v1/jobs/00000000-0000-0000-0000-000000000099/trace', { token })
    expect(res.status).toBe(200)
    const data = (res.body as any).data as any
    // Response shape: { jobId, trace: [...] }
    expect(Array.isArray(data.trace)).toBe(true)
  })

  it('stops the test server', async () => {
    await stopTestServer()
    expect(true).toBe(true)
  })
})
