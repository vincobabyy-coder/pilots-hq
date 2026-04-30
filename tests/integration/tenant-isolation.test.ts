// tests/integration/tenant-isolation.test.ts
// Cryptographic isolation tests: verifies that Organization A can never see Organization B's data.
// No production code is modified. All setup is local to this file.

import { describe, it, expect } from '../runner'
import { startTestServer, stopTestServer, request } from './helpers/server'
import { createOrg, createUser, login } from '../../api/services/auth.service'
import { query } from '../../core/db/pool'

describe('Tenant Isolation', () => {
  let tokenA = ''
  let tokenB = ''
  let orgAId = ''
  let orgBId = ''

  // IDs for resources created under OrgA that OrgB will attempt to access
  let orgAOrderId = ''
  let orgAShipmentId = ''

  it('sets up two isolated organizations', async () => {
    await startTestServer()

    const ts = Date.now()

    // --- OrgA ---
    const orgA = await createOrg('Isolation OrgA', `isolation-orga-${ts}`)
    orgAId = orgA.id
    const userA = await createUser(
      orgAId,
      `isolation-a-${ts}@example.com`,
      'Password123!',
      'OrgA Admin',
      'admin'
    )
    const rowsA = await query<{ email: string }>('SELECT email FROM users WHERE id = $1', [userA.id])
    const tokensA = await login(rowsA[0].email, 'Password123!')
    tokenA = tokensA.accessToken

    // --- OrgB ---
    const orgB = await createOrg('Isolation OrgB', `isolation-orgb-${ts}`)
    orgBId = orgB.id
    const userB = await createUser(
      orgBId,
      `isolation-b-${ts}@example.com`,
      'Password123!',
      'OrgB Admin',
      'admin'
    )
    const rowsB = await query<{ email: string }>('SELECT email FROM users WHERE id = $1', [userB.id])
    const tokensB = await login(rowsB[0].email, 'Password123!')
    tokenB = tokensB.accessToken

    // Sanity: both tokens are non-empty strings and differ from each other
    expect(typeof tokenA).toBe('string')
    expect(typeof tokenB).toBe('string')
    // Tokens must belong to different orgs — they will differ because the org claim differs
    expect(tokenA === tokenB).toBe(false)
    expect(orgAId === orgBId).toBe(false)
  })

  // ─── ORDERS isolation ──────────────────────────────────────────────────────

  it('creates an order under OrgA for cross-tenant lookup tests', async () => {
    const res = await request('POST', '/api/v1/orders', {
      token: tokenA,
      body: {
        orderNumber: `ORD-ISO-A-${Date.now()}`,
        destinationAddress: { street: '1 Tenant Blvd', city: 'Lagos', country: 'NG' },
        items: [{ sku: 'SKU-ISO-001', quantity: 3 }],
      },
    })
    // Accept 200 or 201; record the id for later cross-tenant lookup
    const isSuccess = res.status === 200 || res.status === 201
    expect(isSuccess).toBe(true)
    const data = (res.body as Record<string, unknown>).data as Record<string, unknown>
    const order = data.order as Record<string, unknown>
    orgAOrderId = order.id as string
    expect(typeof orgAOrderId).toBe('string')
  })

  it('OrgA cannot see OrgB orders via list endpoint', async () => {
    // OrgB lists orders — must not contain orgAOrderId
    const res = await request('GET', '/api/v1/orders', { token: tokenB })
    expect(res.status).toBe(200)
    const data = (res.body as Record<string, unknown>).data as Record<string, unknown>
    const orders = data.orders as Array<Record<string, unknown>>
    expect(Array.isArray(orders)).toBe(true)

    const leaked = orders.some((o) => o.id === orgAOrderId)
    expect(leaked).toBe(false)
  })

  it('OrgA cannot see OrgB orders via direct ID lookup', async () => {
    // OrgB tries to GET the specific OrgA order by ID — must be 404, never 200 with data
    const res = await request('GET', `/api/v1/orders/${orgAOrderId}`, { token: tokenB })
    expect(res.status).toBe(404)
  })

  // ─── SHIPMENTS isolation ───────────────────────────────────────────────────

  it('creates a shipment under OrgA for cross-tenant lookup tests', async () => {
    // Shipments require at least one order id. Use the OrgA order created above.
    const res = await request('POST', '/api/v1/shipments', {
      token: tokenA,
      body: {
        orderIds: [orgAOrderId],
        destinationAddress: { street: '1 Tenant Blvd', city: 'Lagos', country: 'NG' },
      },
    })
    const isSuccess = res.status === 200 || res.status === 201
    expect(isSuccess).toBe(true)
    const data = (res.body as Record<string, unknown>).data as Record<string, unknown>
    const shipment = data.shipment as Record<string, unknown>
    orgAShipmentId = shipment.id as string
    expect(typeof orgAShipmentId).toBe('string')
  })

  it('OrgA cannot see OrgB shipments via list endpoint', async () => {
    // OrgB lists shipments — must not contain OrgA's shipment
    const res = await request('GET', '/api/v1/shipments', { token: tokenB })
    expect(res.status).toBe(200)
    const data = (res.body as Record<string, unknown>).data as Record<string, unknown>
    const shipments = data.shipments as Array<Record<string, unknown>>
    expect(Array.isArray(shipments)).toBe(true)

    const leaked = shipments.some((s) => s.id === orgAShipmentId)
    expect(leaked).toBe(false)
  })

  it('OrgA cannot see OrgB shipments via direct ID lookup', async () => {
    // OrgB tries to GET the specific OrgA shipment — must be 404
    const res = await request('GET', `/api/v1/shipments/${orgAShipmentId}`, { token: tokenB })
    expect(res.status).toBe(404)
  })

  // ─── WAREHOUSES isolation ──────────────────────────────────────────────────

  it('OrgA cannot see OrgB warehouses via list endpoint', async () => {
    // First verify OrgA can list its own warehouses (baseline sanity)
    const resA = await request('GET', '/api/v1/warehouses', { token: tokenA })
    expect(resA.status).toBe(200)
    const dataA = (resA.body as Record<string, unknown>).data as Record<string, unknown>
    const warehousesA = dataA.warehouses as Array<Record<string, unknown>>
    expect(Array.isArray(warehousesA)).toBe(true)

    // OrgB lists warehouses — result must not contain any warehouse belonging to OrgA
    const resB = await request('GET', '/api/v1/warehouses', { token: tokenB })
    expect(resB.status).toBe(200)
    const dataB = (resB.body as Record<string, unknown>).data as Record<string, unknown>
    const warehousesB = dataB.warehouses as Array<Record<string, unknown>>
    expect(Array.isArray(warehousesB)).toBe(true)

    // None of OrgA's warehouse IDs should appear in OrgB's list
    const orgAWarehouseIds = new Set(warehousesA.map((w) => w.id as string))
    const leaked = warehousesB.some((w) => orgAWarehouseIds.has(w.id as string))
    expect(leaked).toBe(false)
  })

  // ─── ANALYTICS isolation ───────────────────────────────────────────────────

  it('OrgA analytics do not include OrgB delivery data', async () => {
    // Each org's delivery-stats are scoped to their own tenant.
    // Retrieve stats for OrgA and OrgB separately — they should be independent objects.
    const resA = await request('GET', '/api/v1/analytics/delivery-stats', { token: tokenA })
    expect(resA.status).toBe(200)
    const statsA = ((resA.body as Record<string, unknown>).data as Record<string, unknown>).stats

    const resB = await request('GET', '/api/v1/analytics/delivery-stats', { token: tokenB })
    expect(resB.status).toBe(200)
    const statsB = ((resB.body as Record<string, unknown>).data as Record<string, unknown>).stats

    // Both responses must be valid objects (not null, not undefined)
    expect(typeof statsA).toBe('object')
    expect(typeof statsB).toBe('object')

    // The OrgB stats object must not reference OrgA's ID anywhere
    const statsBStr = JSON.stringify(statsB)
    expect(statsBStr.includes(orgAId)).toBe(false)
  })

  // ─── FRAUD baseline isolation ──────────────────────────────────────────────

  it('OrgA fraud baseline does not affect OrgB baseline', async () => {
    const metric = 'test_metric_isolation'

    // Train a baseline under OrgA
    const trainRes = await request('POST', '/api/v1/fraud/baseline/train', {
      token: tokenA,
      body: {
        metric,
        values: [10, 12, 15, 11, 13, 14, 10, 16, 12, 11],
      },
    })
    expect(trainRes.status).toBe(200)

    // OrgB attempts to read the same metric — must get 404 (cross-tenant baseline is invisible)
    const readRes = await request('GET', `/api/v1/fraud/baseline/${metric}`, { token: tokenB })
    expect(readRes.status).toBe(404)
  })

  // ─── CROSS-TOKEN attempts ──────────────────────────────────────────────────

  it('using OrgB token on OrgA-specific resource returns 403 or 404, never 200 with data', async () => {
    // Attempt to access OrgA's order and shipment with OrgB's token
    const orderRes = await request('GET', `/api/v1/orders/${orgAOrderId}`, { token: tokenB })
    const shipmentRes = await request('GET', `/api/v1/shipments/${orgAShipmentId}`, { token: tokenB })

    // Neither may return 200
    expect(orderRes.status === 200).toBe(false)
    expect(shipmentRes.status === 200).toBe(false)

    // Each must be 403 or 404 (the canonical "not found for your tenant" response)
    const orderBlocked = orderRes.status === 403 || orderRes.status === 404
    const shipmentBlocked = shipmentRes.status === 403 || shipmentRes.status === 404
    expect(orderBlocked).toBe(true)
    expect(shipmentBlocked).toBe(true)
  })

  it('stops the test server', async () => {
    await stopTestServer()
    expect(true).toBe(true)
  })
})
