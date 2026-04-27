import { describe, it, expect } from '../runner'
import { query } from '../../core/db/pool'
import { sign } from '../../core/auth/jwt'
import { optimizeRoutes, getJobStatus } from '../../api/services/route.service'
import { createUser } from '../../api/services/auth.service'
import { readFileSync } from 'fs'

// Side effect: registers and starts the background route-optimization worker
import '../../api/routes/routes'

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
  } catch { /* ignore */ }
}
loadEnv()

const TEST_ORG_ID = '00000000-0000-0000-0000-000000000001'
const POLL_INTERVAL_MS = 500
const POLL_TIMEOUT_MS = 35_000

describe('Route Optimization Integration', () => {
  // uid keeps seeded rows isolated across test runs
  const uid = Date.now().toString(36)

  let adminUserId: string
  let warehouseId: string
  let vehicleId1: string
  let vehicleId2: string
  let orderId1: string
  let orderId2: string
  let orderId3: string
  let jobId: string

  // ------------------------------------------------------------------
  // Setup
  // ------------------------------------------------------------------

  it('resolves admin user in test org', async () => {
    const rows = await query<{ id: string }>(
      "SELECT id FROM users WHERE org_id = $1 AND role = 'admin' LIMIT 1",
      [TEST_ORG_ID]
    )
    if (rows.length > 0) {
      adminUserId = rows[0].id
    } else {
      const u = await createUser(
        TEST_ORG_ID,
        `admin-routes-${uid}@example.com`,
        'Password123!',
        'Routes Admin',
        'admin'
      )
      adminUserId = u.id
    }
    expect(typeof adminUserId).toBe('string')
  })

  it('seeds a warehouse', async () => {
    const [row] = await query<{ id: string }>(
      `INSERT INTO warehouses (org_id, name, lat, lon, address)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       RETURNING id`,
      [
        TEST_ORG_ID,
        `Test Warehouse ${uid}`,
        6.5244,
        3.3792,
        '{"street":"1 Test Rd","city":"Lagos"}',
      ]
    )
    warehouseId = row.id
    expect(typeof warehouseId).toBe('string')
  })

  it('seeds 2 vehicles', async () => {
    const [r1] = await query<{ id: string }>(
      `INSERT INTO vehicles (org_id, license_plate, type, capacity_kg, capacity_cbm, status)
       VALUES ($1, $2, 'van', 1000, 10.0, 'available')
       RETURNING id`,
      [TEST_ORG_ID, `TV1-${uid}`]
    )
    vehicleId1 = r1.id

    const [r2] = await query<{ id: string }>(
      `INSERT INTO vehicles (org_id, license_plate, type, capacity_kg, capacity_cbm, status)
       VALUES ($1, $2, 'van', 1000, 10.0, 'available')
       RETURNING id`,
      [TEST_ORG_ID, `TV2-${uid}`]
    )
    vehicleId2 = r2.id

    expect(typeof vehicleId1).toBe('string')
    expect(typeof vehicleId2).toBe('string')
  })

  it('seeds 3 pending orders', async () => {
    const origin = '{"street":"0 Origin St","city":"Lagos"}'
    const seeds = [
      { dest: '{"street":"11 Dest","city":"Lagos"}', lat: 6.525, lon: 3.381, num: `TO1-${uid}` },
      { dest: '{"street":"22 Dest","city":"Lagos"}', lat: 6.533, lon: 3.370, num: `TO2-${uid}` },
      { dest: '{"street":"33 Dest","city":"Lagos"}', lat: 6.510, lon: 3.392, num: `TO3-${uid}` },
    ]

    const ids: string[] = []
    for (const s of seeds) {
      const [row] = await query<{ id: string }>(
        `INSERT INTO orders
           (org_id, order_number, origin_address, destination_address,
            dest_lat, dest_lon, items, total_weight_kg, total_volume_cbm, status)
         VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6, '[]'::jsonb, 50, 1.0, 'pending')
         RETURNING id`,
        [TEST_ORG_ID, s.num, origin, s.dest, s.lat, s.lon]
      )
      ids.push(row.id)
    }
    ;[orderId1, orderId2, orderId3] = ids

    expect(typeof orderId1).toBe('string')
    expect(typeof orderId2).toBe('string')
    expect(typeof orderId3).toBe('string')
  })

  // ------------------------------------------------------------------
  // Core assertions
  // ------------------------------------------------------------------

  it('POST /api/v1/routes/optimize returns a jobId', async () => {
    // Sign a JWT — this is what the auth middleware validates before the
    // route handler runs; we call the service layer directly here (same
    // pattern as auth.test.ts) but sign the token to confirm the payload.
    const token = sign(
      { sub: adminUserId, org: TEST_ORG_ID, role: 'admin' },
      process.env.JWT_SECRET!,
      3600
    )
    expect(typeof token).toBe('string')

    jobId = await optimizeRoutes(TEST_ORG_ID, {
      warehouseId,
      date: '2026-05-01',
      vehicleIds: [vehicleId1, vehicleId2],
      orderIds: [orderId1, orderId2, orderId3],
    })
    expect(typeof jobId).toBe('string')
  })

  it('GET /api/v1/routes/jobs/:jobId reaches status done within 35s', async () => {
    const deadline = Date.now() + POLL_TIMEOUT_MS
    let status = ''

    while (Date.now() < deadline) {
      const job = await getJobStatus(jobId)
      if (!job) throw new Error(`Job ${jobId} not found in queue`)
      status = job.status
      if (status === 'done') break
      if (status === 'failed') throw new Error(`Optimization job failed: ${job.error ?? 'unknown error'}`)
      await new Promise<void>(resolve => setTimeout(resolve, POLL_INTERVAL_MS))
    }

    expect(status).toBe('done')
  })

  it('has at least one route created in the routes table', async () => {
    const routes = await query<{ id: string }>(
      'SELECT id FROM routes WHERE org_id = $1',
      [TEST_ORG_ID]
    )
    expect(routes.length >= 1).toBe(true)
  })

  // ------------------------------------------------------------------
  // Cleanup
  // ------------------------------------------------------------------

  it('cleans up seeded rows', async () => {
    await query('DELETE FROM routes WHERE org_id = $1', [TEST_ORG_ID])

    const orderIds = [orderId1, orderId2, orderId3].filter((id): id is string => Boolean(id))
    if (orderIds.length > 0) {
      await query('DELETE FROM orders WHERE id = ANY($1)', [orderIds])
    }

    const vehicleIds = [vehicleId1, vehicleId2].filter((id): id is string => Boolean(id))
    if (vehicleIds.length > 0) {
      await query('DELETE FROM vehicles WHERE id = ANY($1)', [vehicleIds])
    }

    if (warehouseId) {
      await query('DELETE FROM warehouses WHERE id = $1', [warehouseId])
    }

    expect(true).toBe(true)
  })
})
