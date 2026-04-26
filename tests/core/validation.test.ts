import { describe, it, expect } from '../runner'
import { v } from '../../core/validation/schema'

describe('Schema Validator', () => {
  it('validates a required string', () => {
    const schema = v.object({ name: v.string().required() })
    const result = schema.parse({ name: 'Alice' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.name).toBe('Alice')
  })

  it('returns error for missing required string', () => {
    const schema = v.object({ name: v.string().required() })
    const result = schema.parse({})
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors[0].field).toBe('name')
  })

  it('validates email format', () => {
    const schema = v.object({ email: v.string().required().email() })
    expect(schema.parse({ email: 'bad' }).ok).toBe(false)
    expect(schema.parse({ email: 'a@b.com' }).ok).toBe(true)
  })

  it('validates number min/max', () => {
    const schema = v.object({ age: v.number().required().min(0).max(120) })
    expect(schema.parse({ age: -1 }).ok).toBe(false)
    expect(schema.parse({ age: 25 }).ok).toBe(true)
    expect(schema.parse({ age: 200 }).ok).toBe(false)
  })

  it('validates nested object', () => {
    const schema = v.object({
      address: v.object({ city: v.string().required() }).required()
    })
    expect(schema.parse({ address: { city: 'Lagos' } }).ok).toBe(true)
    expect(schema.parse({ address: {} }).ok).toBe(false)
  })

  it('validates UUID format', () => {
    const schema = v.object({ id: v.string().required().uuid() })
    expect(schema.parse({ id: 'not-a-uuid' }).ok).toBe(false)
    expect(schema.parse({ id: '550e8400-e29b-41d4-a716-446655440000' }).ok).toBe(true)
  })
})
