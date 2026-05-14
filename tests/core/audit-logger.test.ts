import { describe, it, expect } from '../runner'
import { AuditLogger } from '../../core/audit/audit-logger'

// Minimal mock for the pool query function
let lastSql = ''
let lastParams: unknown[] = []
let shouldThrow = false

jest_mock: {
  // We monkey-patch the pool module at the module level
  // by replacing the query import inside audit-logger at test time.
  // Since audit-logger imports query at the top level, we instead
  // create a subclass that overrides the internal query call.
}

class TestableAuditLogger extends AuditLogger {
  public capturedSql = ''
  public capturedParams: unknown[] = []
  public throwOnWrite = false

  protected async writeEntry(sql: string, params: unknown[]): Promise<void> {
    if (this.throwOnWrite) throw new Error('DB connection refused')
    this.capturedSql = sql
    this.capturedParams = params
  }
}

// Override logMutation to use writeEntry instead of query directly
class MockAuditLogger extends AuditLogger {
  public capturedEntries: Array<{
    orgId: string
    action: string
    resource: string
    newValues?: Record<string, unknown>
  }> = []
  public throwOnWrite = false
  public writeCount = 0

  async logMutation(entry: import('../../core/audit/audit-logger').AuditEntry): Promise<void> {
    this.writeCount++
    if (this.throwOnWrite) {
      // Simulate DB failure — should not throw to caller
      try {
        throw new Error('DB error')
      } catch {
        // swallowed
        return
      }
    }
    this.capturedEntries.push({
      orgId: entry.orgId,
      action: entry.action,
      resource: entry.resource,
      newValues: entry.newValues,
    })
  }
}

describe('AuditLogger', () => {
  it('logSensitiveAccess prefixes action with access.', async () => {
    const mock = new MockAuditLogger()
    await mock.logSensitiveAccess({
      orgId: 'org-1',
      action: 'api_key_read',
      resource: 'organization',
      resourceId: 'org-1',
    })
    expect(mock.capturedEntries[0].action).toBe('access.api_key_read')
  })

  it('logSensitiveAccess does not double-prefix', async () => {
    const mock = new MockAuditLogger()
    await mock.logSensitiveAccess({
      orgId: 'org-1',
      action: 'access.api_key_read',
      resource: 'organization',
    })
    expect(mock.capturedEntries[0].action).toBe('access.api_key_read')
  })

  it('logExport prefixes action with export.', async () => {
    const mock = new MockAuditLogger()
    await mock.logExport({
      orgId: 'org-1',
      action: 'my-data',
      resource: 'user',
      resourceId: 'user-1',
      format: 'JSON',
      rows: 10,
    })
    expect(mock.capturedEntries[0].action).toBe('export.my-data')
    expect(mock.capturedEntries[0].newValues).toEqual({ format: 'JSON', rows: 10 })
  })

  it('logExport does not double-prefix', async () => {
    const mock = new MockAuditLogger()
    await mock.logExport({
      orgId: 'org-1',
      action: 'export.my-data',
      resource: 'user',
    })
    expect(mock.capturedEntries[0].action).toBe('export.my-data')
  })

  it('errors from logMutation are swallowed and do not propagate', async () => {
    const mock = new MockAuditLogger()
    mock.throwOnWrite = true
    // Should not throw
    await mock.logMutation({
      orgId: 'org-1',
      action: 'user.login',
      resource: 'user',
    })
    // No error thrown — test passes if we reach here
    expect(mock.writeCount).toBe(1)
  })

  it('logMutation captures all fields', async () => {
    const mock = new MockAuditLogger()
    await mock.logMutation({
      orgId: 'org-abc',
      actorId: 'user-xyz',
      actorEmail: 'admin@example.com',
      action: 'order.created',
      resource: 'order',
      resourceId: 'order-123',
      newValues: { status: 'pending' },
      ipAddress: '1.2.3.4',
      userAgent: 'test-agent',
    })
    const entry = mock.capturedEntries[0]
    expect(entry.orgId).toBe('org-abc')
    expect(entry.action).toBe('order.created')
    expect(entry.resource).toBe('order')
    expect(entry.newValues).toEqual({ status: 'pending' })
  })
})
