import { describe, it, expect } from '../runner'
import { select } from '../../core/db/query-builder'

// Query builder tests are pure (no DB connection needed)
describe('QueryBuilder', () => {
  it('builds a basic SELECT', () => {
    const { sql, params } = select('users').build()
    expect(sql).toBe('SELECT * FROM users')
    expect(params).toHaveLength(0)
  })

  it('builds SELECT with WHERE', () => {
    const { sql, params } = select('users').where({ org_id: 'abc', status: 'active' }).build()
    expect(sql).toBe('SELECT * FROM users WHERE org_id = $1 AND status = $2')
    expect(params).toHaveLength(2)
    expect(params[0]).toBe('abc')
    expect(params[1]).toBe('active')
  })

  it('builds SELECT with LIMIT and OFFSET', () => {
    const { sql } = select('orders').limit(10).offset(20).build()
    expect(sql).toBe('SELECT * FROM orders LIMIT 10 OFFSET 20')
  })

  it('builds SELECT with ORDER BY', () => {
    const { sql } = select('shipments').orderBy('created_at', 'DESC').build()
    expect(sql).toBe('SELECT * FROM shipments ORDER BY created_at DESC')
  })

  it('builds SELECT with specific columns', () => {
    const { sql } = select('users').select('id', 'email', 'name').build()
    expect(sql).toBe('SELECT id, email, name FROM users')
  })

  it('builds SELECT with whereRaw', () => {
    const { sql, params } = select('orders')
      .where({ org_id: 'org1' })
      .whereRaw('created_at > $1', [new Date('2024-01-01')])
      .build()
    expect(sql).toBe('SELECT * FROM orders WHERE org_id = $1 AND created_at > $2')
    expect(params).toHaveLength(2)
  })
})
