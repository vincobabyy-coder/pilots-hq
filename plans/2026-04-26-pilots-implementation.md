# PILOTS Week 1: Core Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build every core primitive PILOTS needs — HTTP server, auth, validation, DB access, migration runner, rate limiter, multi-tenant middleware — as 100% proprietary TypeScript, no external packages except `pg`, `ioredis`, and `typescript`.

**Architecture:** Custom HTTP server built on Node.js `http` module. Trie-based router. Middleware pipeline. JWT via `crypto.createHmac`. Passwords via `crypto.pbkdf2Sync`. PostgreSQL via raw `pg` pool with a hand-written query builder. Redis via `ioredis` for rate limiting and cache. All code compiled with `tsc`, run with `node`.

**Tech Stack:** Node.js 20 LTS, TypeScript 5, PostgreSQL 15, Redis 7. Allowed packages: `pg`, `ioredis`, `typescript`, `@types/pg`, `@types/node`.

---

## Consistent Types (reference for all tasks)

```typescript
// core/http/types.ts — imported by everything HTTP-related
export interface PilotsRequest {
  method: string
  url: string
  path: string
  query: Record<string, string>
  params: Record<string, string>
  headers: Record<string, string>
  body: unknown
  requestId: string
  userId?: string
  orgId?: string
  userRole?: string
}

export interface PilotsResponse {
  status(code: number): PilotsResponse
  setHeader(name: string, value: string): PilotsResponse
  json(data: unknown): void
  ok(data: unknown, meta?: Record<string, unknown>): void
  fail(code: string, message: string, httpStatus?: number, fields?: Array<{field: string; message: string}>): void
  end(): void
}

export type Handler = (req: PilotsRequest, res: PilotsResponse) => Promise<void> | void
export type Middleware = (req: PilotsRequest, res: PilotsResponse, next: () => Promise<void>) => Promise<void> | void
```

---

## File Map

| File | Purpose |
|------|---------|
| `package.json` | Minimal deps, build/test scripts |
| `tsconfig.json` | Strict TypeScript config |
| `docker-compose.yml` | Local PostgreSQL + Redis |
| `.env.example` | Required env vars |
| `tests/runner.ts` | Proprietary test runner |
| `tests/run-all.ts` | Entry point that imports all test files |
| `core/logger/logger.ts` | Structured JSON logger |
| `core/validation/schema.ts` | Runtime type validator |
| `core/auth/jwt.ts` | HS256 JWT sign/verify |
| `core/auth/password.ts` | pbkdf2 hash/verify |
| `core/db/pool.ts` | pg connection pool wrapper |
| `core/db/query-builder.ts` | SQL query builder |
| `core/db/migrator.ts` | Migration runner |
| `db/migrations/001_organizations.sql` | organizations + _migrations tables |
| `db/migrations/002_users.sql` | users table |
| `core/http/types.ts` | Shared HTTP types |
| `core/http/request.ts` | PilotsRequest builder |
| `core/http/response.ts` | PilotsResponse builder |
| `core/http/router.ts` | Trie-based router |
| `core/http/server.ts` | PilotsServer class |
| `core/http/middleware.ts` | Security headers, CORS, body parser, request logger |
| `core/auth/middleware.ts` | JWT verification middleware |
| `api/middleware/rate-limiter.ts` | Token bucket rate limiter |
| `api/middleware/tenant.ts` | Multi-tenant org context injector |
| `api/middleware/error-handler.ts` | Global error handler |
| `api/services/auth.service.ts` | Login, refresh, me logic |
| `api/routes/auth.ts` | POST /auth/login, POST /auth/refresh, GET /auth/me |
| `api/index.ts` | Wires all middleware + routes, starts server |
| `tests/core/logger.test.ts` | Logger unit tests |
| `tests/core/jwt.test.ts` | JWT unit tests |
| `tests/core/password.test.ts` | Password unit tests |
| `tests/core/validation.test.ts` | Schema validator unit tests |
| `tests/core/router.test.ts` | Router unit tests |
| `tests/integration/auth.test.ts` | Full login → refresh → me flow |

---

## Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `docker-compose.yml`
- Create: `.env.example`

- [ ] **Step 1: Create the project directory**

```bash
mkdir -p /Users/tifeatere/Desktop/GOV/pilots
cd /Users/tifeatere/Desktop/GOV/pilots
git init
```

- [ ] **Step 2: Write `package.json`**

```json
{
  "name": "pilots",
  "version": "0.1.0",
  "description": "Prism Intelligent Logistics & Operations Tracking System",
  "private": true,
  "scripts": {
    "build": "tsc",
    "test": "tsc && node dist/tests/run-all.js",
    "dev": "tsc -w",
    "start": "node dist/api/index.js",
    "migrate": "node dist/core/db/migrate.js"
  },
  "dependencies": {
    "pg": "^8.11.0",
    "ioredis": "^5.3.0"
  },
  "devDependencies": {
    "typescript": "^5.3.0",
    "@types/pg": "^8.10.0",
    "@types/node": "^20.0.0"
  }
}
```

- [ ] **Step 3: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": true,
    "sourceMap": true,
    "noImplicitAny": true,
    "noImplicitReturns": true
  },
  "include": [
    "core/**/*.ts",
    "api/**/*.ts",
    "engines/**/*.ts",
    "tests/**/*.ts",
    "db/**/*.ts"
  ],
  "exclude": ["node_modules", "dist", "clients"]
}
```

- [ ] **Step 4: Write `docker-compose.yml`**

```yaml
version: '3.9'
services:
  postgres:
    image: timescale/timescaledb:latest-pg15
    environment:
      POSTGRES_DB: pilots
      POSTGRES_USER: pilots
      POSTGRES_PASSWORD: pilots_local
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

volumes:
  pgdata:
```

- [ ] **Step 5: Write `.env.example`**

```
DATABASE_URL=postgresql://pilots:pilots_local@localhost:5432/pilots
REDIS_URL=redis://localhost:6379
JWT_SECRET=change_me_minimum_32_chars_long_secret_key
JWT_REFRESH_SECRET=change_me_different_refresh_secret_key
PORT=3000
NODE_ENV=development
```

- [ ] **Step 6: Install dependencies and verify TypeScript works**

```bash
cd /Users/tifeatere/Desktop/GOV/pilots
npm install
npx tsc --version
```

Expected output: `Version 5.x.x`

- [ ] **Step 7: Create directory structure**

```bash
mkdir -p core/logger core/auth core/validation core/db core/http core/cache core/events
mkdir -p api/routes api/middleware api/services
mkdir -p engines/route-optimizer engines/tracking engines/allocation engines/analytics engines/fraud
mkdir -p db/migrations
mkdir -p tests/core tests/api tests/integration
mkdir -p clients/web clients/mobile clients/truck clients/portal
```

- [ ] **Step 8: Commit scaffold**

```bash
cd /Users/tifeatere/Desktop/GOV/pilots
git add .
git commit -m "feat: project scaffold — tsconfig, docker-compose, directory structure"
```

---

## Task 2: Proprietary Test Runner

**Files:**
- Create: `tests/runner.ts`
- Create: `tests/run-all.ts`

- [ ] **Step 1: Write `tests/runner.ts`**

```typescript
// tests/runner.ts
// Proprietary async test runner. No Jest, no Mocha.

interface TestCase {
  suite: string
  name: string
  fn: () => Promise<void> | void
}

const registry: TestCase[] = []
let currentSuite = 'root'

export function describe(name: string, fn: () => void): void {
  const prev = currentSuite
  currentSuite = name
  fn()
  currentSuite = prev
}

export function it(name: string, fn: () => Promise<void> | void): void {
  registry.push({ suite: currentSuite, name, fn })
}

export { it as test }

class AssertionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AssertionError'
  }
}

class Expect {
  constructor(private value: unknown) {}

  toBe(expected: unknown): void {
    if (this.value !== expected) {
      throw new AssertionError(`Expected ${JSON.stringify(this.value)} to be ${JSON.stringify(expected)}`)
    }
  }

  toEqual(expected: unknown): void {
    if (JSON.stringify(this.value) !== JSON.stringify(expected)) {
      throw new AssertionError(`Expected ${JSON.stringify(this.value)} to equal ${JSON.stringify(expected)}`)
    }
  }

  toBeNull(): void {
    if (this.value !== null) {
      throw new AssertionError(`Expected ${JSON.stringify(this.value)} to be null`)
    }
  }

  toBeTruthy(): void {
    if (!this.value) {
      throw new AssertionError(`Expected ${JSON.stringify(this.value)} to be truthy`)
    }
  }

  toBeFalsy(): void {
    if (this.value) {
      throw new AssertionError(`Expected ${JSON.stringify(this.value)} to be falsy`)
    }
  }

  toContain(item: unknown): void {
    if (!Array.isArray(this.value) && typeof this.value !== 'string') {
      throw new AssertionError(`toContain requires array or string`)
    }
    if (!(this.value as unknown[]).includes(item as never)) {
      throw new AssertionError(`Expected ${JSON.stringify(this.value)} to contain ${JSON.stringify(item)}`)
    }
  }

  toHaveLength(len: number): void {
    const actual = (this.value as { length: number }).length
    if (actual !== len) {
      throw new AssertionError(`Expected length ${len} but got ${actual}`)
    }
  }

  toThrow(message?: string): void {
    if (typeof this.value !== 'function') {
      throw new AssertionError(`toThrow requires a function`)
    }
    let threw = false
    let thrownMessage = ''
    try {
      (this.value as () => void)()
    } catch (e) {
      threw = true
      thrownMessage = (e as Error).message
    }
    if (!threw) throw new AssertionError(`Expected function to throw`)
    if (message && !thrownMessage.includes(message)) {
      throw new AssertionError(`Expected throw message to contain "${message}" but got "${thrownMessage}"`)
    }
  }

  async toReject(message?: string): Promise<void> {
    if (typeof this.value !== 'function') {
      throw new AssertionError(`toReject requires a function`)
    }
    let threw = false
    let thrownMessage = ''
    try {
      await (this.value as () => Promise<void>)()
    } catch (e) {
      threw = true
      thrownMessage = (e as Error).message
    }
    if (!threw) throw new AssertionError(`Expected async function to reject`)
    if (message && !thrownMessage.includes(message)) {
      throw new AssertionError(`Expected rejection message to contain "${message}" but got "${thrownMessage}"`)
    }
  }
}

export function expect(value: unknown): Expect {
  return new Expect(value)
}

export async function run(): Promise<number> {
  let passed = 0
  let failed = 0
  const failures: string[] = []

  console.log(`\nRunning ${registry.length} tests...\n`)

  for (const test of registry) {
    try {
      await test.fn()
      passed++
      process.stdout.write(`  ✓ [${test.suite}] ${test.name}\n`)
    } catch (e) {
      failed++
      const msg = (e as Error).message
      failures.push(`  ✗ [${test.suite}] ${test.name}\n    ${msg}`)
      process.stdout.write(`  ✗ [${test.suite}] ${test.name}\n`)
    }
  }

  console.log(`\n${passed} passed, ${failed} failed\n`)

  if (failures.length > 0) {
    console.log('Failures:\n')
    failures.forEach(f => console.log(f))
  }

  return failed === 0 ? 0 : 1
}
```

- [ ] **Step 2: Write `tests/run-all.ts`** (will be populated as test files are added)

```typescript
// tests/run-all.ts
import { run } from './runner'

// Test files are imported here — each registers its tests on import.
// Add each new test file below as it is created.

run().then(code => process.exit(code))
```

- [ ] **Step 3: Build and verify runner compiles**

```bash
cd /Users/tifeatere/Desktop/GOV/pilots
npm run build 2>&1 | head -20
```

Expected: No errors. `dist/tests/runner.js` and `dist/tests/run-all.js` created.

- [ ] **Step 4: Run empty test suite**

```bash
node dist/tests/run-all.js
```

Expected output:
```
Running 0 tests...

0 passed, 0 failed
```

- [ ] **Step 5: Commit**

```bash
git add tests/runner.ts tests/run-all.ts
git commit -m "feat: proprietary test runner — describe/it/expect, async support, TAP-style output"
```

---

## Task 3: Structured Logger

**Files:**
- Create: `core/logger/logger.ts`
- Create: `tests/core/logger.test.ts`

- [ ] **Step 1: Write failing test `tests/core/logger.test.ts`**

```typescript
import { describe, it, expect } from '../runner'
import { logger } from '../../core/logger/logger'

describe('Logger', () => {
  it('exports info, warn, error, debug methods', () => {
    expect(typeof logger.info).toBe('function')
    expect(typeof logger.warn).toBe('function')
    expect(typeof logger.error).toBe('function')
    expect(typeof logger.debug).toBe('function')
  })

  it('does not throw when called with message only', () => {
    expect(() => logger.info('test message')).not?.toThrow?.()
    // Manually verify: should not throw
    logger.info('hello')
    logger.warn('warn', { requestId: 'r1' })
    logger.error('error', { orgId: 'org1' })
  })
})
```

- [ ] **Step 2: Register test in `tests/run-all.ts`**

```typescript
import { run } from './runner'
import './core/logger.test'

run().then(code => process.exit(code))
```

- [ ] **Step 3: Run test — expect failure (module not found)**

```bash
npm run build 2>&1 | grep -i error
```

Expected: `Cannot find module '../../core/logger/logger'`

- [ ] **Step 4: Write `core/logger/logger.ts`**

```typescript
type LogLevel = 'debug' | 'info' | 'warn' | 'error'

interface LogContext {
  requestId?: string
  orgId?: string
  [key: string]: unknown
}

function log(level: LogLevel, msg: string, context: LogContext = {}): void {
  const entry = JSON.stringify({ level, ts: new Date().toISOString(), msg, ...context })
  const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout
  stream.write(entry + '\n')
}

export const logger = {
  debug: (msg: string, ctx?: LogContext) => log('debug', msg, ctx),
  info:  (msg: string, ctx?: LogContext) => log('info',  msg, ctx),
  warn:  (msg: string, ctx?: LogContext) => log('warn',  msg, ctx),
  error: (msg: string, ctx?: LogContext) => log('error', msg, ctx),
}
```

- [ ] **Step 5: Build and run tests — expect pass**

```bash
npm run build && node dist/tests/run-all.js
```

Expected:
```
Running 2 tests...

  ✓ [Logger] exports info, warn, error, debug methods
  ✓ [Logger] does not throw when called with message only

2 passed, 0 failed
```

- [ ] **Step 6: Commit**

```bash
git add core/logger/logger.ts tests/core/logger.test.ts tests/run-all.ts
git commit -m "feat: structured JSON logger — stdout for info/debug, stderr for warn/error"
```

---

## Task 4: Schema Validator

**Files:**
- Create: `core/validation/schema.ts`
- Create: `tests/core/validation.test.ts`

- [ ] **Step 1: Write failing tests `tests/core/validation.test.ts`**

```typescript
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
```

- [ ] **Step 2: Add to `tests/run-all.ts`**

```typescript
import { run } from './runner'
import './core/logger.test'
import './core/validation.test'

run().then(code => process.exit(code))
```

- [ ] **Step 3: Run build — expect failure**

```bash
npm run build 2>&1 | grep error
```

- [ ] **Step 4: Write `core/validation/schema.ts`**

```typescript
export type FieldError = { field: string; message: string }
export type ValidationResult<T> =
  | { ok: true; data: T }
  | { ok: false; errors: FieldError[] }

class StringValidator {
  private _required = false
  private _minLength?: number
  private _maxLength?: number
  private _isEmail = false
  private _isUuid = false

  required(): this { this._required = true; return this }
  min(n: number): this { this._minLength = n; return this }
  max(n: number): this { this._maxLength = n; return this }
  email(): this { this._isEmail = true; return this }
  uuid(): this { this._isUuid = true; return this }

  validate(value: unknown, field: string): FieldError[] {
    const errors: FieldError[] = []
    if (value === undefined || value === null || value === '') {
      if (this._required) errors.push({ field, message: `${field} is required` })
      return errors
    }
    if (typeof value !== 'string') {
      errors.push({ field, message: `${field} must be a string` }); return errors
    }
    if (this._minLength !== undefined && value.length < this._minLength)
      errors.push({ field, message: `${field} must be at least ${this._minLength} characters` })
    if (this._maxLength !== undefined && value.length > this._maxLength)
      errors.push({ field, message: `${field} must be at most ${this._maxLength} characters` })
    if (this._isEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
      errors.push({ field, message: `${field} must be a valid email address` })
    if (this._isUuid && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))
      errors.push({ field, message: `${field} must be a valid UUID` })
    return errors
  }
}

class NumberValidator {
  private _required = false
  private _min?: number
  private _max?: number

  required(): this { this._required = true; return this }
  min(n: number): this { this._min = n; return this }
  max(n: number): this { this._max = n; return this }

  validate(value: unknown, field: string): FieldError[] {
    const errors: FieldError[] = []
    if (value === undefined || value === null) {
      if (this._required) errors.push({ field, message: `${field} is required` })
      return errors
    }
    if (typeof value !== 'number' || isNaN(value)) {
      errors.push({ field, message: `${field} must be a number` }); return errors
    }
    if (this._min !== undefined && value < this._min)
      errors.push({ field, message: `${field} must be >= ${this._min}` })
    if (this._max !== undefined && value > this._max)
      errors.push({ field, message: `${field} must be <= ${this._max}` })
    return errors
  }
}

type AnyValidator = StringValidator | NumberValidator | ObjectValidator

class ObjectValidator {
  private _required = false
  constructor(private shape: Record<string, AnyValidator>) {}

  required(): this { this._required = true; return this }

  validate(value: unknown, field: string): FieldError[] {
    const errors: FieldError[] = []
    if (value === undefined || value === null) {
      if (this._required) errors.push({ field, message: `${field} is required` })
      return errors
    }
    if (typeof value !== 'object' || Array.isArray(value)) {
      errors.push({ field, message: `${field} must be an object` }); return errors
    }
    const obj = value as Record<string, unknown>
    for (const [key, validator] of Object.entries(this.shape)) {
      errors.push(...validator.validate(obj[key], field === 'root' ? key : `${field}.${key}`))
    }
    return errors
  }

  parse(input: unknown): ValidationResult<Record<string, unknown>> {
    const errors = this.validate(input, 'root')
    if (errors.length > 0) return { ok: false, errors }
    return { ok: true, data: input as Record<string, unknown> }
  }
}

export const v = {
  string: () => new StringValidator(),
  number: () => new NumberValidator(),
  object: (shape: Record<string, AnyValidator>) => new ObjectValidator(shape),
}
```

- [ ] **Step 5: Build and run tests — expect all pass**

```bash
npm run build && node dist/tests/run-all.js
```

Expected: `8 passed, 0 failed`

- [ ] **Step 6: Commit**

```bash
git add core/validation/schema.ts tests/core/validation.test.ts tests/run-all.ts
git commit -m "feat: proprietary schema validator — string/number/object, nested, email/uuid/min/max"
```

---

## Task 5: JWT Module

**Files:**
- Create: `core/auth/jwt.ts`
- Create: `tests/core/jwt.test.ts`

- [ ] **Step 1: Write failing tests `tests/core/jwt.test.ts`**

```typescript
import { describe, it, expect } from '../runner'
import { sign, verify } from '../../core/auth/jwt'

const SECRET = 'test-secret-at-least-32-characters-long'

describe('JWT', () => {
  it('sign produces a 3-part dot-separated token', () => {
    const token = sign({ sub: 'user1', org: 'org1', role: 'admin' }, SECRET, 3600)
    const parts = token.split('.')
    expect(parts).toHaveLength(3)
  })

  it('verify returns the original payload', () => {
    const token = sign({ sub: 'user1', org: 'org1', role: 'admin' }, SECRET, 3600)
    const payload = verify(token, SECRET)
    expect(payload.sub).toBe('user1')
    expect(payload.org).toBe('org1')
    expect(payload.role).toBe('admin')
  })

  it('verify throws on wrong secret', () => {
    const token = sign({ sub: 'user1', org: 'org1', role: 'admin' }, SECRET, 3600)
    expect(() => verify(token, 'wrong-secret')).toThrow('Invalid token signature')
  })

  it('verify throws on tampered payload', () => {
    const token = sign({ sub: 'user1', org: 'org1', role: 'admin' }, SECRET, 3600)
    const parts = token.split('.')
    // Replace middle (payload) with tampered version
    const tampered = parts[0] + '.' + Buffer.from('{"sub":"hacker"}').toString('base64url') + '.' + parts[2]
    expect(() => verify(tampered, SECRET)).toThrow('Invalid token signature')
  })

  it('verify throws on expired token', async () => {
    const token = sign({ sub: 'user1', org: 'org1', role: 'admin' }, SECRET, -1)
    expect(() => verify(token, SECRET)).toThrow('Token expired')
  })
})
```

- [ ] **Step 2: Add to `tests/run-all.ts`**

```typescript
import { run } from './runner'
import './core/logger.test'
import './core/validation.test'
import './core/jwt.test'

run().then(code => process.exit(code))
```

- [ ] **Step 3: Write `core/auth/jwt.ts`**

```typescript
import { createHmac } from 'crypto'

export interface JwtPayload {
  sub: string
  org: string
  role: string
  iat: number
  exp: number
}

function base64url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function decodeBase64url(input: string): string {
  const padded = input + '==='.slice((input.length + 3) % 4)
  return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
}

function hmac(data: string, secret: string): string {
  return base64url(createHmac('sha256', secret).update(data).digest())
}

export function sign(
  payload: Omit<JwtPayload, 'iat' | 'exp'>,
  secret: string,
  expiresInSeconds: number
): string {
  const now = Math.floor(Date.now() / 1000)
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = base64url(JSON.stringify({ ...payload, iat: now, exp: now + expiresInSeconds }))
  const sig = hmac(`${header}.${body}`, secret)
  return `${header}.${body}.${sig}`
}

export function verify(token: string, secret: string): JwtPayload {
  const parts = token.split('.')
  if (parts.length !== 3) throw new Error('Invalid token format')
  const [header, body, sig] = parts
  const expectedSig = hmac(`${header}.${body}`, secret)
  if (sig !== expectedSig) throw new Error('Invalid token signature')
  const payload = JSON.parse(decodeBase64url(body)) as JwtPayload
  if (payload.exp < Math.floor(Date.now() / 1000)) throw new Error('Token expired')
  return payload
}
```

- [ ] **Step 4: Build and run — expect all pass**

```bash
npm run build && node dist/tests/run-all.js
```

Expected: `13 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add core/auth/jwt.ts tests/core/jwt.test.ts tests/run-all.ts
git commit -m "feat: HS256 JWT sign/verify using Node.js crypto — no external library"
```

---

## Task 6: Password Hashing

**Files:**
- Create: `core/auth/password.ts`
- Create: `tests/core/password.test.ts`

- [ ] **Step 1: Write failing tests `tests/core/password.test.ts`**

```typescript
import { describe, it, expect } from '../runner'
import { hashPassword, verifyPassword } from '../../core/auth/password'

describe('Password', () => {
  it('hashPassword returns salt:hash format', () => {
    const hash = hashPassword('secret123')
    const parts = hash.split(':')
    expect(parts).toHaveLength(2)
    expect(parts[0].length).toBe(128) // 64 bytes hex = 128 chars
    expect(parts[1].length).toBe(128)
  })

  it('two hashes of same password are different (different salts)', () => {
    const h1 = hashPassword('secret123')
    const h2 = hashPassword('secret123')
    expect(h1 === h2).toBe(false)
  })

  it('verifyPassword returns true for correct password', () => {
    const hash = hashPassword('mypassword')
    expect(verifyPassword('mypassword', hash)).toBe(true)
  })

  it('verifyPassword returns false for wrong password', () => {
    const hash = hashPassword('mypassword')
    expect(verifyPassword('wrongpassword', hash)).toBe(false)
  })

  it('verifyPassword returns false for malformed stored value', () => {
    expect(verifyPassword('any', 'notahash')).toBe(false)
  })
})
```

- [ ] **Step 2: Add to `tests/run-all.ts`**

```typescript
import { run } from './runner'
import './core/logger.test'
import './core/validation.test'
import './core/jwt.test'
import './core/password.test'

run().then(code => process.exit(code))
```

- [ ] **Step 3: Write `core/auth/password.ts`**

```typescript
import { randomBytes, pbkdf2Sync } from 'crypto'

const ITERATIONS = 100_000
const KEYLEN = 64
const DIGEST = 'sha512'

export function hashPassword(password: string): string {
  const salt = randomBytes(64).toString('hex')
  const hash = pbkdf2Sync(password, salt, ITERATIONS, KEYLEN, DIGEST).toString('hex')
  return `${salt}:${hash}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const colonIndex = stored.indexOf(':')
  if (colonIndex === -1) return false
  const salt = stored.slice(0, colonIndex)
  const storedHash = stored.slice(colonIndex + 1)
  if (!salt || !storedHash) return false
  const hash = pbkdf2Sync(password, salt, ITERATIONS, KEYLEN, DIGEST).toString('hex')
  // Constant-time comparison to prevent timing attacks
  if (hash.length !== storedHash.length) return false
  let diff = 0
  for (let i = 0; i < hash.length; i++) {
    diff |= hash.charCodeAt(i) ^ storedHash.charCodeAt(i)
  }
  return diff === 0
}
```

- [ ] **Step 4: Build and run — expect all pass**

```bash
npm run build && node dist/tests/run-all.js
```

Expected: `18 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add core/auth/password.ts tests/core/password.test.ts tests/run-all.ts
git commit -m "feat: pbkdf2 password hashing — 100k iterations, SHA-512, constant-time verify"
```

---

## Task 7: DB Pool + Query Builder

**Files:**
- Create: `core/db/pool.ts`
- Create: `core/db/query-builder.ts`
- Create: `tests/core/db.test.ts`

> These tests require a running PostgreSQL. Start it first: `docker compose up -d postgres`

- [ ] **Step 1: Write `core/db/pool.ts`**

```typescript
import { Pool, PoolClient, QueryResult } from 'pg'

let pool: Pool | null = null

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 20,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    })
    pool.on('error', (err) => {
      process.stderr.write(JSON.stringify({ level: 'error', msg: 'pg pool error', err: err.message }) + '\n')
    })
  }
  return pool
}

export async function query<T extends Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const result: QueryResult<T> = await getPool().query(sql, params)
  return result.rows
}

export async function queryOne<T extends Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<T | null> {
  const rows = await query<T>(sql, params)
  return rows[0] ?? null
}

export async function transaction<T>(
  fn: (client: { query: typeof query }) => Promise<T>
): Promise<T> {
  const client: PoolClient = await getPool().connect()
  try {
    await client.query('BEGIN')
    const result = await fn({
      query: async <R extends Record<string, unknown>>(sql: string, params: unknown[] = []) => {
        const r: QueryResult<R> = await client.query(sql, params)
        return r.rows
      }
    })
    await client.query('COMMIT')
    return result
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}

export async function closePool(): Promise<void> {
  if (pool) { await pool.end(); pool = null }
}
```

- [ ] **Step 2: Write `core/db/query-builder.ts`**

```typescript
// Lightweight SQL query builder.
// Usage: select('users').where({org_id: 'x', status: 'active'}).limit(10).build()

interface QueryParts {
  table: string
  conditions: string[]
  params: unknown[]
  limitVal?: number
  offsetVal?: number
  orderByCol?: string
  orderDir?: 'ASC' | 'DESC'
  selectedCols: string[]
}

export class QueryBuilder {
  private parts: QueryParts

  constructor(table: string) {
    this.parts = { table, conditions: [], params: [], selectedCols: ['*'] }
  }

  select(...cols: string[]): this {
    this.parts.selectedCols = cols
    return this
  }

  where(conditions: Record<string, unknown>): this {
    for (const [col, val] of Object.entries(conditions)) {
      this.parts.params.push(val)
      this.parts.conditions.push(`${col} = $${this.parts.params.length}`)
    }
    return this
  }

  whereRaw(condition: string, params: unknown[]): this {
    const offset = this.parts.params.length
    this.parts.params.push(...params)
    // Re-number $1, $2 to $offset+1, $offset+2
    const reNumbered = condition.replace(/\$(\d+)/g, (_, n: string) => `$${parseInt(n) + offset}`)
    this.parts.conditions.push(reNumbered)
    return this
  }

  limit(n: number): this { this.parts.limitVal = n; return this }
  offset(n: number): this { this.parts.offsetVal = n; return this }
  orderBy(col: string, dir: 'ASC' | 'DESC' = 'ASC'): this {
    this.parts.orderByCol = col
    this.parts.orderDir = dir
    return this
  }

  build(): { sql: string; params: unknown[] } {
    const { table, conditions, params, limitVal, offsetVal, orderByCol, orderDir, selectedCols } = this.parts
    let sql = `SELECT ${selectedCols.join(', ')} FROM ${table}`
    if (conditions.length > 0) sql += ` WHERE ${conditions.join(' AND ')}`
    if (orderByCol) sql += ` ORDER BY ${orderByCol} ${orderDir ?? 'ASC'}`
    if (limitVal !== undefined) sql += ` LIMIT ${limitVal}`
    if (offsetVal !== undefined) sql += ` OFFSET ${offsetVal}`
    return { sql, params }
  }
}

export function select(table: string): QueryBuilder {
  return new QueryBuilder(table)
}
```

- [ ] **Step 3: Write `tests/core/db.test.ts`**

```typescript
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
```

- [ ] **Step 4: Add to `tests/run-all.ts`**

```typescript
import { run } from './runner'
import './core/logger.test'
import './core/validation.test'
import './core/jwt.test'
import './core/password.test'
import './core/db.test'

run().then(code => process.exit(code))
```

- [ ] **Step 5: Build and run — expect all pass**

```bash
npm run build && node dist/tests/run-all.js
```

Expected: `24 passed, 0 failed`

- [ ] **Step 6: Commit**

```bash
git add core/db/pool.ts core/db/query-builder.ts tests/core/db.test.ts tests/run-all.ts
git commit -m "feat: pg connection pool wrapper + proprietary query builder"
```

---

## Task 8: Migration Runner + Initial Schema

**Files:**
- Create: `core/db/migrator.ts`
- Create: `core/db/migrate.ts` (CLI entry point)
- Create: `db/migrations/001_organizations.sql`
- Create: `db/migrations/002_users.sql`

- [ ] **Step 1: Write `db/migrations/001_organizations.sql`**

```sql
CREATE TABLE IF NOT EXISTS _migrations (
  id SERIAL PRIMARY KEY,
  filename VARCHAR(255) UNIQUE NOT NULL,
  applied_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(100) UNIQUE NOT NULL,
  country_code VARCHAR(2),
  currency_code VARCHAR(3) DEFAULT 'USD',
  api_key VARCHAR(255) UNIQUE,
  webhook_secret_encrypted VARCHAR(500),
  features JSONB DEFAULT '{}'::jsonb,
  settings JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

- [ ] **Step 2: Write `db/migrations/002_users.sql`**

```sql
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL CHECK (role IN ('admin', 'operator', 'dispatcher', 'viewer')),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(org_id, email)
);
CREATE INDEX IF NOT EXISTS idx_users_org ON users(org_id);
```

- [ ] **Step 3: Write `core/db/migrator.ts`**

```typescript
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { query, queryOne } from './pool'
import { logger } from '../logger/logger'

const MIGRATIONS_DIR = join(process.cwd(), 'db', 'migrations')

async function getApplied(): Promise<string[]> {
  try {
    const rows = await query<{ filename: string }>(
      'SELECT filename FROM _migrations ORDER BY id ASC'
    )
    return rows.map(r => r.filename)
  } catch {
    // _migrations table doesn't exist yet — will be created by first migration
    return []
  }
}

async function getMigrationFiles(): Promise<string[]> {
  return readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort()
}

export async function migrate(): Promise<void> {
  const applied = await getApplied()
  const files = await getMigrationFiles()
  const pending = files.filter(f => !applied.includes(f))

  if (pending.length === 0) {
    logger.info('Migrations: nothing to apply')
    return
  }

  for (const filename of pending) {
    const sql = readFileSync(join(MIGRATIONS_DIR, filename), 'utf8')
    logger.info(`Applying migration: ${filename}`)
    // Run each migration in a single query execution
    await query(sql)
    await query(
      'INSERT INTO _migrations (filename) VALUES ($1)',
      [filename]
    )
    logger.info(`Applied: ${filename}`)
  }

  logger.info(`Migrations complete. Applied ${pending.length} migration(s).`)
}
```

- [ ] **Step 4: Write `core/db/migrate.ts`** (CLI entry point)

```typescript
import * as dotenv from 'fs'
import { readFileSync } from 'fs'
import { migrate } from './migrator'
import { closePool } from './pool'

// Load .env manually (no dotenv package)
function loadEnv(): void {
  try {
    const env = readFileSync('.env', 'utf8')
    for (const line of env.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eqIndex = trimmed.indexOf('=')
      if (eqIndex === -1) continue
      const key = trimmed.slice(0, eqIndex).trim()
      const value = trimmed.slice(eqIndex + 1).trim()
      if (!process.env[key]) process.env[key] = value
    }
  } catch {
    // No .env file — rely on environment variables
  }
}

loadEnv()

migrate()
  .then(() => closePool())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Migration failed:', err)
    process.exit(1)
  })
```

- [ ] **Step 5: Copy `.env.example` to `.env` and start Postgres**

```bash
cp .env.example .env
# Edit .env to set your actual values if needed, otherwise defaults work with docker-compose
docker compose up -d postgres
sleep 3  # wait for postgres to start
```

- [ ] **Step 6: Run migrations**

```bash
npm run build && npm run migrate
```

Expected output:
```
{"level":"info","ts":"...","msg":"Applying migration: 001_organizations.sql"}
{"level":"info","ts":"...","msg":"Applied: 001_organizations.sql"}
{"level":"info","ts":"...","msg":"Applying migration: 002_users.sql"}
{"level":"info","ts":"...","msg":"Applied: 002_users.sql"}
{"level":"info","ts":"...","msg":"Migrations complete. Applied 2 migration(s)."}
```

- [ ] **Step 7: Verify tables exist**

```bash
docker exec -it $(docker ps -q -f name=postgres) psql -U pilots -d pilots -c "\dt"
```

Expected: shows `_migrations`, `organizations`, `users` tables.

- [ ] **Step 8: Commit**

```bash
git add core/db/migrator.ts core/db/migrate.ts db/migrations/
git commit -m "feat: migration runner + initial schema — organizations, users"
```

---

## Task 9: HTTP Types + Request/Response Objects

**Files:**
- Create: `core/http/types.ts`
- Create: `core/http/request.ts`
- Create: `core/http/response.ts`

- [ ] **Step 1: Write `core/http/types.ts`**

```typescript
export interface PilotsRequest {
  method: string
  url: string
  path: string
  query: Record<string, string>
  params: Record<string, string>
  headers: Record<string, string>
  body: unknown
  requestId: string
  userId?: string
  orgId?: string
  userRole?: string
}

export interface PilotsResponse {
  status(code: number): PilotsResponse
  setHeader(name: string, value: string): PilotsResponse
  json(data: unknown): void
  ok(data: unknown, meta?: Record<string, unknown>): void
  fail(code: string, message: string, httpStatus?: number, fields?: Array<{field: string; message: string}>): void
  end(): void
}

export type Handler = (req: PilotsRequest, res: PilotsResponse) => Promise<void> | void
export type Middleware = (req: PilotsRequest, res: PilotsResponse, next: () => Promise<void>) => Promise<void> | void
```

- [ ] **Step 2: Write `core/http/request.ts`**

```typescript
import { IncomingMessage } from 'http'
import { randomUUID } from 'crypto'
import { PilotsRequest } from './types'

function parseQuery(search: string): Record<string, string> {
  if (!search) return {}
  const params: Record<string, string> = {}
  for (const [k, v] of new URLSearchParams(search)) {
    params[k] = v
  }
  return params
}

export async function buildRequest(raw: IncomingMessage): Promise<PilotsRequest> {
  const rawUrl = raw.url ?? '/'
  const qIndex = rawUrl.indexOf('?')
  const path = qIndex === -1 ? rawUrl : rawUrl.slice(0, qIndex)
  const queryStr = qIndex === -1 ? '' : rawUrl.slice(qIndex + 1)

  // Parse JSON body
  let body: unknown = null
  const contentType = raw.headers['content-type'] ?? ''
  if (contentType.includes('application/json')) {
    body = await new Promise((resolve, reject) => {
      let data = ''
      raw.on('data', chunk => { data += chunk })
      raw.on('end', () => {
        try { resolve(JSON.parse(data || 'null')) }
        catch { resolve(null) }
      })
      raw.on('error', reject)
    })
  }

  const headers: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw.headers)) {
    if (typeof v === 'string') headers[k] = v
    else if (Array.isArray(v)) headers[k] = v[0] ?? ''
  }

  return {
    method: raw.method ?? 'GET',
    url: rawUrl,
    path,
    query: parseQuery(queryStr),
    params: {},
    headers,
    body,
    requestId: randomUUID(),
  }
}
```

- [ ] **Step 3: Write `core/http/response.ts`**

```typescript
import { ServerResponse } from 'http'
import { PilotsResponse } from './types'

export function buildResponse(raw: ServerResponse, requestId: string): PilotsResponse {
  let statusCode = 200
  let headersSent = false

  const res: PilotsResponse = {
    status(code) {
      statusCode = code
      return res
    },

    setHeader(name, value) {
      raw.setHeader(name, value)
      return res
    },

    json(data) {
      if (headersSent) return
      headersSent = true
      const body = JSON.stringify(data)
      raw.writeHead(statusCode, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      })
      raw.end(body)
    },

    ok(data, meta = {}) {
      res.json({
        success: true,
        data,
        meta: { requestId, timestamp: new Date().toISOString(), ...meta }
      })
    },

    fail(code, message, httpStatus = 400, fields = []) {
      statusCode = httpStatus
      res.json({
        success: false,
        error: { code, message, fields },
        meta: { requestId, timestamp: new Date().toISOString() }
      })
    },

    end() {
      if (!headersSent) { headersSent = true; raw.end() }
    }
  }

  return res
}
```

- [ ] **Step 4: Build and verify compile**

```bash
npm run build 2>&1 | grep -i error
```

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add core/http/types.ts core/http/request.ts core/http/response.ts
git commit -m "feat: PilotsRequest/PilotsResponse — typed HTTP objects wrapping Node.js IncomingMessage/ServerResponse"
```

---

## Task 10: Trie Router

**Files:**
- Create: `core/http/router.ts`
- Create: `tests/core/router.test.ts`

- [ ] **Step 1: Write failing tests `tests/core/router.test.ts`**

```typescript
import { describe, it, expect } from '../runner'
import { Router } from '../../core/http/router'
import { PilotsRequest, PilotsResponse } from '../../core/http/types'

function mockReq(method: string, path: string): PilotsRequest {
  return { method, url: path, path, query: {}, params: {}, headers: {}, body: null, requestId: 'r1' }
}

describe('Router', () => {
  it('matches a static route', async () => {
    const router = new Router()
    let called = false
    router.get('/health', async (_req, _res) => { called = true })
    const match = router.match('GET', '/health')
    expect(match).toBeTruthy()
    if (match) await match.handler(mockReq('GET', '/health'), {} as PilotsResponse)
    expect(called).toBe(true)
  })

  it('returns null for unmatched route', () => {
    const router = new Router()
    router.get('/health', async () => {})
    expect(router.match('GET', '/unknown')).toBeNull()
  })

  it('extracts path params', () => {
    const router = new Router()
    router.get('/users/:id/orders/:orderId', async () => {})
    const match = router.match('GET', '/users/abc123/orders/xyz')
    expect(match).toBeTruthy()
    if (match) {
      expect(match.params['id']).toBe('abc123')
      expect(match.params['orderId']).toBe('xyz')
    }
  })

  it('distinguishes HTTP methods', () => {
    const router = new Router()
    router.get('/items', async () => {})
    router.post('/items', async () => {})
    expect(router.match('GET', '/items')).toBeTruthy()
    expect(router.match('POST', '/items')).toBeTruthy()
    expect(router.match('DELETE', '/items')).toBeNull()
  })

  it('supports nested routers with prefix', () => {
    const v1 = new Router()
    v1.get('/orders', async () => {})
    const main = new Router()
    main.use('/api/v1', v1)
    expect(main.match('GET', '/api/v1/orders')).toBeTruthy()
    expect(main.match('GET', '/api/v2/orders')).toBeNull()
  })
})
```

- [ ] **Step 2: Add to `tests/run-all.ts`**

```typescript
import { run } from './runner'
import './core/logger.test'
import './core/validation.test'
import './core/jwt.test'
import './core/password.test'
import './core/db.test'
import './core/router.test'

run().then(code => process.exit(code))
```

- [ ] **Step 3: Write `core/http/router.ts`**

```typescript
import { Handler, PilotsRequest, PilotsResponse } from './types'

interface RouteEntry {
  method: string
  segments: string[]
  handler: Handler
}

interface MatchResult {
  handler: Handler
  params: Record<string, string>
}

export class Router {
  private routes: RouteEntry[] = []
  private subRouters: Array<{ prefix: string; router: Router }> = []

  private addRoute(method: string, path: string, handler: Handler): void {
    const segments = path.split('/').filter(Boolean)
    this.routes.push({ method: method.toUpperCase(), segments, handler })
  }

  get(path: string, handler: Handler): this { this.addRoute('GET', path, handler); return this }
  post(path: string, handler: Handler): this { this.addRoute('POST', path, handler); return this }
  put(path: string, handler: Handler): this { this.addRoute('PUT', path, handler); return this }
  patch(path: string, handler: Handler): this { this.addRoute('PATCH', path, handler); return this }
  delete(path: string, handler: Handler): this { this.addRoute('DELETE', path, handler); return this }

  use(prefix: string, router: Router): this {
    this.subRouters.push({ prefix, router })
    return this
  }

  match(method: string, path: string): MatchResult | null {
    const incomingSegments = path.split('/').filter(Boolean)

    // Check sub-routers first
    for (const { prefix, router } of this.subRouters) {
      const prefixSegments = prefix.split('/').filter(Boolean)
      if (path.startsWith(prefix)) {
        const remainingPath = '/' + incomingSegments.slice(prefixSegments.length).join('/')
        const result = router.match(method, remainingPath)
        if (result) return result
      }
    }

    // Check own routes
    for (const route of this.routes) {
      if (route.method !== method.toUpperCase()) continue
      if (route.segments.length !== incomingSegments.length) continue

      const params: Record<string, string> = {}
      let matched = true

      for (let i = 0; i < route.segments.length; i++) {
        const routeSeg = route.segments[i]
        const incomingSeg = incomingSegments[i]

        if (routeSeg.startsWith(':')) {
          params[routeSeg.slice(1)] = incomingSeg
        } else if (routeSeg !== incomingSeg) {
          matched = false
          break
        }
      }

      if (matched) return { handler: route.handler, params }
    }

    return null
  }
}
```

- [ ] **Step 4: Build and run tests — expect all pass**

```bash
npm run build && node dist/tests/run-all.js
```

Expected: `29 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add core/http/router.ts tests/core/router.test.ts tests/run-all.ts
git commit -m "feat: router — static routes, path params, HTTP method discrimination, nested routers"
```

---

## Task 11: HTTP Server + Core Middleware

**Files:**
- Create: `core/http/server.ts`
- Create: `core/http/middleware.ts`

- [ ] **Step 1: Write `core/http/server.ts`**

```typescript
import { createServer, IncomingMessage, ServerResponse } from 'http'
import { buildRequest } from './request'
import { buildResponse } from './response'
import { Router } from './router'
import { Middleware, PilotsRequest, PilotsResponse } from './types'
import { logger } from '../logger/logger'

export class PilotsServer {
  private middlewares: Middleware[] = []
  private router = new Router()

  use(middleware: Middleware): this {
    this.middlewares.push(middleware)
    return this
  }

  mount(path: string, router: Router): this {
    this.router.use(path, router)
    return this
  }

  router_(): Router {
    return this.router
  }

  private async handle(req: PilotsRequest, res: PilotsResponse): Promise<void> {
    // Build middleware chain ending with router dispatch
    const dispatch = async (): Promise<void> => {
      const match = this.router.match(req.method, req.path)
      if (!match) {
        res.status(404).fail('NOT_FOUND', `Route ${req.method} ${req.path} not found`, 404)
        return
      }
      req.params = match.params
      await match.handler(req, res)
    }

    // Run middleware pipeline
    let i = 0
    const next = async (): Promise<void> => {
      if (i < this.middlewares.length) {
        const mw = this.middlewares[i++]
        await mw(req, res, next)
      } else {
        await dispatch()
      }
    }

    try {
      await next()
    } catch (err) {
      logger.error('Unhandled error in request pipeline', { error: (err as Error).message, path: req.path })
      if (!res['_ended']) {
        res.status(500).fail('INTERNAL_ERROR', 'Internal server error', 500)
      }
    }
  }

  listen(port: number, onReady?: () => void): void {
    const server = createServer(async (raw: IncomingMessage, rawRes: ServerResponse) => {
      const req = await buildRequest(raw)
      const res = buildResponse(rawRes, req.requestId)
      await this.handle(req, res)
    })
    server.listen(port, () => {
      logger.info(`PILOTS server listening`, { port })
      onReady?.()
    })
  }
}
```

- [ ] **Step 2: Write `core/http/middleware.ts`**

```typescript
import { Middleware } from './types'
import { logger } from '../logger/logger'

export const securityHeaders: Middleware = async (_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('X-XSS-Protection', '1; mode=block')
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  res.setHeader('Referrer-Policy', 'no-referrer')
  await next()
}

export const cors = (allowedOrigins: string[] = ['*']): Middleware => async (req, res, next) => {
  const origin = req.headers['origin'] ?? ''
  const allowed = allowedOrigins.includes('*') || allowedOrigins.includes(origin)
  if (allowed) {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigins.includes('*') ? '*' : origin)
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    res.setHeader('Access-Control-Max-Age', '86400')
  }
  if (req.method === 'OPTIONS') { res.status(204).end(); return }
  await next()
}

export const requestLogger: Middleware = async (req, res, next) => {
  const start = Date.now()
  await next()
  logger.info('request', {
    requestId: req.requestId,
    method: req.method,
    path: req.path,
    ms: Date.now() - start,
    orgId: req.orgId,
  })
}
```

- [ ] **Step 3: Build and verify**

```bash
npm run build 2>&1 | grep -i error
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add core/http/server.ts core/http/middleware.ts
git commit -m "feat: PilotsServer — createServer wrapper, middleware pipeline, router dispatch"
```

---

## Task 12: Auth Middleware + Rate Limiter + Tenant Middleware

**Files:**
- Create: `core/auth/middleware.ts`
- Create: `api/middleware/rate-limiter.ts`
- Create: `api/middleware/tenant.ts`
- Create: `api/middleware/error-handler.ts`

- [ ] **Step 1: Write `core/auth/middleware.ts`**

```typescript
import { Middleware } from '../http/types'
import { verify } from './jwt'

// Routes that do not require authentication
const PUBLIC_PATHS = [
  'POST /api/v1/auth/login',
  'POST /api/v1/auth/refresh',
  'GET /api/v1/tracking',  // customer portal — prefix match
]

function isPublic(method: string, path: string): boolean {
  const key = `${method} ${path}`
  return PUBLIC_PATHS.some(p => key.startsWith(p))
}

export const authenticate: Middleware = async (req, res, next) => {
  if (isPublic(req.method, req.path)) { await next(); return }

  const authHeader = req.headers['authorization'] ?? ''
  if (!authHeader.startsWith('Bearer ')) {
    res.status(401).fail('UNAUTHORIZED', 'Missing or invalid Authorization header', 401)
    return
  }

  const token = authHeader.slice(7)
  try {
    const secret = process.env.JWT_SECRET
    if (!secret) throw new Error('JWT_SECRET not configured')
    const payload = verify(token, secret)
    req.userId = payload.sub
    req.orgId = payload.org
    req.userRole = payload.role
    await next()
  } catch (e) {
    res.status(401).fail('UNAUTHORIZED', (e as Error).message, 401)
  }
}
```

- [ ] **Step 2: Start Redis for rate limiter tests**

```bash
docker compose up -d redis
```

- [ ] **Step 3: Write `api/middleware/rate-limiter.ts`**

```typescript
import { Middleware } from '../../core/http/types'
import Redis from 'ioredis'

let redis: Redis | null = null

function getRedis(): Redis {
  if (!redis) redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379')
  return redis
}

interface RateLimitConfig {
  windowMs: number      // time window in milliseconds
  maxRequests: number   // max requests per window
}

const DEFAULT_LIMITS: Record<string, RateLimitConfig> = {
  'POST /api/v1/auth/login': { windowMs: 60_000, maxRequests: 10 },
  'default': { windowMs: 60_000, maxRequests: 100 },
}

export function rateLimiter(config?: RateLimitConfig): Middleware {
  return async (req, res, next) => {
    const key = `rl:${req.headers['x-forwarded-for'] ?? req.headers['host'] ?? 'unknown'}:${req.method}:${req.path}`
    const limit = config ?? DEFAULT_LIMITS[`${req.method} ${req.path}`] ?? DEFAULT_LIMITS['default']

    const r = getRedis()
    const now = Date.now()
    const windowStart = now - limit.windowMs

    // Sliding window using Redis sorted set
    await r.zremrangebyscore(key, '-inf', windowStart)
    const count = await r.zcard(key)

    if (count >= limit.maxRequests) {
      const oldest = await r.zrange(key, 0, 0, 'WITHSCORES')
      const retryAfter = oldest.length >= 2
        ? Math.ceil((parseInt(oldest[1]) + limit.windowMs - now) / 1000)
        : Math.ceil(limit.windowMs / 1000)
      res.setHeader('Retry-After', String(retryAfter))
      res.status(429).fail('RATE_LIMITED', 'Too many requests', 429)
      return
    }

    await r.zadd(key, now, `${now}-${Math.random()}`)
    await r.pexpire(key, limit.windowMs)
    await next()
  }
}
```

- [ ] **Step 4: Write `api/middleware/tenant.ts`**

```typescript
import { Middleware } from '../../core/http/types'
// orgId is already injected by authenticate middleware from JWT.
// This middleware validates the org still exists in the DB.
import { queryOne } from '../../core/db/pool'

export const tenantContext: Middleware = async (req, res, next) => {
  // Skip for public routes (orgId will be undefined)
  if (!req.orgId) { await next(); return }

  const org = await queryOne<{ id: string; features: Record<string, unknown> }>(
    'SELECT id, features FROM organizations WHERE id = $1',
    [req.orgId]
  )

  if (!org) {
    res.status(401).fail('UNAUTHORIZED', 'Organization not found', 401)
    return
  }

  await next()
}
```

- [ ] **Step 5: Write `api/middleware/error-handler.ts`**

```typescript
import { Middleware } from '../../core/http/types'
import { logger } from '../../core/logger/logger'

export const errorHandler: Middleware = async (req, res, next) => {
  try {
    await next()
  } catch (err) {
    logger.error('Unhandled route error', {
      requestId: req.requestId,
      path: req.path,
      error: (err as Error).message,
      stack: (err as Error).stack,
    })
    res.status(500).fail('INTERNAL_ERROR', 'An unexpected error occurred', 500)
  }
}
```

- [ ] **Step 6: Build and verify**

```bash
npm run build 2>&1 | grep -i error
```

Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add core/auth/middleware.ts api/middleware/
git commit -m "feat: auth middleware (JWT verify), rate limiter (sliding window, Redis), tenant context"
```

---

## Task 13: Auth Service + Routes

**Files:**
- Create: `api/services/auth.service.ts`
- Create: `api/routes/auth.ts`

- [ ] **Step 1: Write `api/services/auth.service.ts`**

```typescript
import { query, queryOne } from '../../core/db/pool'
import { hashPassword, verifyPassword } from '../../core/auth/password'
import { sign, verify } from '../../core/auth/jwt'
import { logger } from '../../core/logger/logger'

interface UserRow {
  id: string
  org_id: string
  email: string
  password_hash: string
  name: string
  role: string
}

export interface AuthTokens {
  accessToken: string
  refreshToken: string
  expiresIn: number
}

const ACCESS_TTL = 3600         // 1 hour
const REFRESH_TTL = 7 * 86400  // 7 days

export async function login(email: string, password: string): Promise<AuthTokens> {
  const user = await queryOne<UserRow>(
    'SELECT id, org_id, email, password_hash, name, role FROM users WHERE email = $1',
    [email.toLowerCase().trim()]
  )
  if (!user) throw new Error('Invalid credentials')
  if (!verifyPassword(password, user.password_hash)) throw new Error('Invalid credentials')

  const secret = process.env.JWT_SECRET!
  const refreshSecret = process.env.JWT_REFRESH_SECRET!

  const accessToken = sign({ sub: user.id, org: user.org_id, role: user.role }, secret, ACCESS_TTL)
  const refreshToken = sign({ sub: user.id, org: user.org_id, role: user.role }, refreshSecret, REFRESH_TTL)

  logger.info('User logged in', { userId: user.id, orgId: user.org_id })
  return { accessToken, refreshToken, expiresIn: ACCESS_TTL }
}

export async function refresh(refreshToken: string): Promise<AuthTokens> {
  const refreshSecret = process.env.JWT_REFRESH_SECRET!
  const secret = process.env.JWT_SECRET!

  const payload = verify(refreshToken, refreshSecret)

  const user = await queryOne<UserRow>(
    'SELECT id, org_id, role FROM users WHERE id = $1',
    [payload.sub]
  )
  if (!user) throw new Error('User not found')

  const accessToken = sign({ sub: user.id, org: user.org_id, role: user.role }, secret, ACCESS_TTL)
  const newRefreshToken = sign({ sub: user.id, org: user.org_id, role: user.role }, refreshSecret, REFRESH_TTL)

  return { accessToken, refreshToken: newRefreshToken, expiresIn: ACCESS_TTL }
}

export async function getMe(userId: string): Promise<Omit<UserRow, 'password_hash'>> {
  const user = await queryOne<Omit<UserRow, 'password_hash'>>(
    'SELECT id, org_id, email, name, role FROM users WHERE id = $1',
    [userId]
  )
  if (!user) throw new Error('User not found')
  return user
}

export async function createOrg(name: string, slug: string): Promise<{ id: string }> {
  const rows = await query<{ id: string }>(
    'INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id',
    [name, slug]
  )
  return rows[0]
}

export async function createUser(
  orgId: string, email: string, password: string, name: string, role: string
): Promise<{ id: string }> {
  const hash = hashPassword(password)
  const rows = await query<{ id: string }>(
    'INSERT INTO users (org_id, email, password_hash, name, role) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [orgId, email.toLowerCase().trim(), hash, name, role]
  )
  return rows[0]
}
```

- [ ] **Step 2: Write `api/routes/auth.ts`**

```typescript
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
```

- [ ] **Step 3: Commit**

```bash
git add api/services/auth.service.ts api/routes/auth.ts
git commit -m "feat: auth service (login/refresh/me) + auth router — POST /auth/login, /auth/refresh, GET /auth/me"
```

---

## Task 14: Application Entry Point + Integration Test

**Files:**
- Create: `api/index.ts`
- Create: `tests/integration/auth.test.ts`
- Create: `db/migrations/003_seed_test_data.sql`

- [ ] **Step 1: Write `api/index.ts`**

```typescript
import { readFileSync } from 'fs'
import { PilotsServer } from '../core/http/server'
import { securityHeaders, cors, requestLogger } from '../core/http/middleware'
import { authenticate } from '../core/auth/middleware'
import { rateLimiter } from './middleware/rate-limiter'
import { tenantContext } from './middleware/tenant'
import { errorHandler } from './middleware/error-handler'
import { authRouter } from './routes/auth'
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

  const port = parseInt(process.env.PORT ?? '3000')
  server.listen(port, () => {
    logger.info('PILOTS API ready', { port, env: process.env.NODE_ENV })
  })
}

bootstrap().catch(err => {
  console.error('Bootstrap failed:', err)
  process.exit(1)
})
```

- [ ] **Step 2: Write `db/migrations/003_seed_test_data.sql`**

```sql
-- Insert test org and admin user for integration tests
-- Password: 'TestPassword123!' (hashed separately — this is a placeholder hash)
-- Run scripts/seed-test-user.ts to generate real hash
INSERT INTO organizations (id, name, slug) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Test Org', 'test-org')
ON CONFLICT (id) DO NOTHING;
```

- [ ] **Step 3: Write `scripts/seed-test-user.ts`** (one-time seed helper)

```typescript
import { readFileSync } from 'fs'
import { hashPassword } from '../core/auth/password'
import { query, closePool } from '../core/db/pool'

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

const hash = hashPassword('TestPassword123!')
query(
  `INSERT INTO users (id, org_id, email, password_hash, name, role)
   VALUES ('00000000-0000-0000-0000-000000000002',
           '00000000-0000-0000-0000-000000000001',
           'admin@test-org.com', $1, 'Test Admin', 'admin')
   ON CONFLICT DO NOTHING`,
  [hash]
).then(() => {
  console.log('Test user seeded: admin@test-org.com / TestPassword123!')
  return closePool()
}).then(() => process.exit(0))
```

- [ ] **Step 4: Run migrations and seed**

```bash
npm run build
npm run migrate
node dist/scripts/seed-test-user.js
```

Expected:
```
Test user seeded: admin@test-org.com / TestPassword123!
```

- [ ] **Step 5: Start server and verify it responds**

```bash
node dist/api/index.js &
sleep 1
curl -s http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@test-org.com","password":"TestPassword123!"}' | jq .
```

Expected response:
```json
{
  "success": true,
  "data": {
    "accessToken": "eyJ...",
    "refreshToken": "eyJ...",
    "expiresIn": 3600
  },
  "meta": { "requestId": "...", "timestamp": "..." }
}
```

- [ ] **Step 6: Write integration test `tests/integration/auth.test.ts`**

```typescript
import { describe, it, expect } from '../runner'
import { login, refresh, getMe, createOrg, createUser } from '../../api/services/auth.service'
import { query } from '../../core/db/pool'
import { readFileSync } from 'fs'

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

describe('Auth Integration', () => {
  let orgId: string
  let userId: string

  it('creates an org', async () => {
    const org = await createOrg('Integration Test Org', `int-test-${Date.now()}`)
    expect(typeof org.id).toBe('string')
    orgId = org.id
  })

  it('creates a user in the org', async () => {
    const user = await createUser(orgId, `test${Date.now()}@example.com`, 'Password123!', 'Tester', 'admin')
    expect(typeof user.id).toBe('string')
    userId = user.id
  })

  it('login returns access and refresh tokens', async () => {
    // We need the email we just created — query it
    const rows = await query<{ email: string }>('SELECT email FROM users WHERE id = $1', [userId])
    const email = rows[0].email
    const tokens = await login(email, 'Password123!')
    expect(typeof tokens.accessToken).toBe('string')
    expect(typeof tokens.refreshToken).toBe('string')
    expect(tokens.expiresIn).toBe(3600)
  })

  it('login throws on wrong password', async () => {
    const rows = await query<{ email: string }>('SELECT email FROM users WHERE id = $1', [userId])
    const email = rows[0].email
    let threw = false
    try { await login(email, 'wrongpassword') } catch { threw = true }
    expect(threw).toBe(true)
  })

  it('getMe returns user details', async () => {
    const user = await getMe(userId)
    expect(user.id).toBe(userId)
    expect(user.role).toBe('admin')
  })
})
```

- [ ] **Step 7: Add integration test to `tests/run-all.ts`**

```typescript
import { run } from './runner'
import './core/logger.test'
import './core/validation.test'
import './core/jwt.test'
import './core/password.test'
import './core/db.test'
import './core/router.test'
import './integration/auth.test'

run().then(code => process.exit(code))
```

- [ ] **Step 8: Build and run all tests (requires running Postgres)**

```bash
npm run build && node dist/tests/run-all.js
```

Expected:
```
Running 34 tests...

  ✓ [Logger] exports info, warn, error, debug methods
  ... (all previous tests)
  ✓ [Auth Integration] creates an org
  ✓ [Auth Integration] creates a user in the org
  ✓ [Auth Integration] login returns access and refresh tokens
  ✓ [Auth Integration] login throws on wrong password
  ✓ [Auth Integration] getMe returns user details

34 passed, 0 failed
```

- [ ] **Step 9: Final Week 1 commit**

```bash
kill %1  # stop background server if running
git add api/index.ts db/migrations/003_seed_test_data.sql scripts/seed-test-user.ts tests/integration/auth.test.ts tests/run-all.ts
git commit -m "feat: application entry point + auth integration test — Week 1 complete"
```

---

## Week 1 Verification Checklist

Before marking Week 1 complete:

- [ ] `tsc --noEmit` produces zero errors
- [ ] `node dist/tests/run-all.js` shows `34 passed, 0 failed`
- [ ] `node dist/api/index.js` starts without error
- [ ] `curl POST /api/v1/auth/login` returns `{ success: true, data: { accessToken, refreshToken } }`
- [ ] `curl GET /api/v1/auth/me` with Bearer token returns user object
- [ ] `curl GET /api/v1/auth/me` without token returns `{ success: false, error: { code: "UNAUTHORIZED" } }`
- [ ] No packages in `node_modules` except `pg`, `ioredis`, `typescript`, `@types/pg`, `@types/node`
- [ ] Migrations run cleanly on a fresh database (`docker compose down -v && docker compose up -d && npm run migrate`)

---

## Week 2: Route Optimizer — Task Outline

**Goal:** `POST /api/v1/routes/optimize` returns optimal routes for a set of orders.

| Task | Description |
|------|-------------|
| 2.1 | DB migrations: orders, vehicles, routes, speed_profiles tables |
| 2.2 | `engines/route-optimizer/distance-matrix.ts` — Haversine distance, learned speed profiles |
| 2.3 | `engines/route-optimizer/greedy-init.ts` — Nearest-neighbor greedy initial solution |
| 2.4 | `engines/route-optimizer/branch-and-bound.ts` — B&B solver with insertion cost + lower bound pruning |
| 2.5 | `engines/route-optimizer/vrp.ts` — Top-level solver: greedy init → B&B with 30s time limit |
| 2.6 | `api/services/route.service.ts` — createOptimizationJob, pollJob, confirmRoute |
| 2.7 | `api/routes/routes.ts` — POST /optimize, GET /jobs/:jobId, GET /:id, POST /:id/confirm |
| 2.8 | `api/routes/orders.ts` — POST /orders, GET /orders, GET /orders/:id |
| 2.9 | Tests: VRP correctness on 3-stop known-optimal instance, performance <5s for 50 stops |
| 2.10 | Integration test: create orders → POST /routes/optimize → poll → confirm |

---

## Week 3: Tracking Engine + WebSocket Server — Task Outline

**Goal:** Live shipment state updated via events; WebSocket clients receive updates sub-second.

| Task | Description |
|------|-------------|
| 3.1 | DB migrations: shipments, shipment_orders, tracking_events (TimescaleDB hypertable) |
| 3.2 | `engines/tracking/event-log.ts` — append-only event log, persist to tracking_events |
| 3.3 | `engines/tracking/state-machine.ts` — pure reducer: `(state, event) => newState` |
| 3.4 | `engines/tracking/commands.ts` — appendEvent, updateLocation, markDelivered, flagException |
| 3.5 | `engines/tracking/queries.ts` — getCurrentState (replay), findLateShipments, getHistory |
| 3.6 | `engines/tracking/spatial-index.ts` — proprietary R-tree: insert/search by bounding box, Haversine filter |
| 3.7 | `core/ws/server.ts` — RFC 6455 handshake (SHA-1, base64, crypto), frame parser/serializer |
| 3.8 | `core/ws/connection.ts` — connection lifecycle, ping/pong heartbeat, graceful close |
| 3.9 | `core/ws/rooms.ts` — room subscribe/unsubscribe/publish, Redis-backed for multi-instance |
| 3.10 | `api/routes/shipments.ts` — POST /shipments, GET /:id, GET /:id/events, PATCH /:id/exception |
| 3.11 | `api/routes/drivers.ts` — PATCH /:id/location (triggers location_updated event + WS broadcast) |
| 3.12 | Tests: event sourcing idempotency, state replay correctness, WS handshake, room pub/sub |

---

## Week 4: Allocation Engine + Full Job Queue — Task Outline

**Goal:** Orders auto-allocated to optimal warehouse; job queue running all scheduled tasks.

| Task | Description |
|------|-------------|
| 4.1 | DB migrations: warehouses, warehouse_inventory, drivers, vehicles |
| 4.2 | `engines/allocation/bipartite-graph.ts` — build cost matrix (distance + inventory + utilization) |
| 4.3 | `engines/allocation/hungarian.ts` — Kuhn-Munkres O(n³) optimal assignment |
| 4.4 | `core/queue/queue.ts` — Redis-backed named queues (LPUSH/BRPOP), job persistence, concurrency control |
| 4.5 | `core/queue/worker.ts` — job processor, retry with exponential backoff, dead-letter queue |
| 4.6 | `core/queue/scheduler.ts` — cron-style scheduler using Redis sorted sets (score = next run ms) |
| 4.7 | `api/routes/warehouses.ts` — GET /warehouses, POST /warehouses, GET /:id/inventory |
| 4.8 | `api/routes/orders.ts` — POST /orders/allocate (triggers Hungarian allocation) |
| 4.9 | Register scheduled jobs: route optimization (06:00), forecast update (00:30), speed profile update (01:00) |
| 4.10 | Tests: Hungarian on 3×3 known-optimal instance, queue persistence across restart, job retry |

---

## Week 5: Predictive Analytics + Fraud Detector — Task Outline

**Goal:** Delivery time predictions with confidence intervals; fraud scores on all completions.

| Task | Description |
|------|-------------|
| 5.1 | `engines/analytics/percentile.ts` — fixed-bucket histogram, P50/P95/P99, average |
| 5.2 | `engines/analytics/hyperloglog.ts` — proprietary HyperLogLog for unique count estimation |
| 5.3 | `engines/analytics/delivery-predictor.ts` — speed profile learner per (hour, dow), predict with CI |
| 5.4 | `engines/analytics/time-series.ts` — 7-day moving average trend, day-of-week seasonality |
| 5.5 | `engines/analytics/demand-forecast.ts` — additive model: trend + seasonality + 95% CI |
| 5.6 | `engines/fraud/baseline.ts` — compute μ and σ for delivery time, stops/route, distances |
| 5.7 | `engines/fraud/cusum.ts` — CUSUM control chart for persistent drift detection |
| 5.8 | `engines/fraud/detector.ts` — Z-score checks + CUSUM, returns isAnomaly + score + reasons |
| 5.9 | `api/routes/analytics.ts` — GET /kpis, GET /timeseries, GET /forecasts, GET /exceptions |
| 5.10 | Auto-attach fraud score when driver marks delivery complete |
| 5.11 | Tests: percentile accuracy, forecast on synthetic 90-day dataset, fraud detection on labeled anomalies |

---

## Week 6: Web Dashboard — Task Outline

**Goal:** Fully functional operator dashboard with live map and real-time WebSocket updates.

| Task | Description |
|------|-------------|
| 6.1 | `clients/web/` — tsconfig, custom build script (tsc + single HTML entry point, no webpack) |
| 6.2 | `clients/web/src/http-client.ts` — fetch-based typed client, auto-attach Authorization header, handle 401 |
| 6.3 | `clients/web/src/store.ts` — proprietary reactive store (EventEmitter-based, typed selectors) |
| 6.4 | `clients/web/src/ws-client.ts` — WebSocket client wrapper, auto-reconnect, room subscription |
| 6.5 | `clients/web/src/pages/Login.tsx` — login form → POST /auth/login → store token |
| 6.6 | `clients/web/src/pages/Dashboard.tsx` — KPI cards, exception count, live delivery counter |
| 6.7 | `clients/web/src/pages/Orders.tsx` — table with filter/sort/pagination |
| 6.8 | `clients/web/src/pages/Shipments.tsx` — list + status badges + click to detail |
| 6.9 | `clients/web/src/pages/RouteMap.tsx` — Leaflet map, driver markers, route polylines |
| 6.10 | `clients/web/src/pages/Analytics.tsx` — KPI charts (drawn with HTML5 Canvas, no chart library) |
| 6.11 | `clients/web/src/pages/Drivers.tsx` — driver list, status, performance rating |
| 6.12 | `clients/web/src/pages/Warehouses.tsx` — warehouse list, inventory levels |

---

## Week 7: Driver Mobile App — Task Outline

**Goal:** Driver app with offline GPS, delivery confirmation, proof-of-delivery.

| Task | Description |
|------|-------------|
| 7.1 | `clients/mobile/` — React Native project scaffold (no Expo) |
| 7.2 | `clients/mobile/src/storage.ts` — offline queue using React Native's built-in SQLite bindings |
| 7.3 | `clients/mobile/src/ws-client.ts` — WebSocket with exponential backoff reconnect |
| 7.4 | `clients/mobile/src/screens/Login.tsx` |
| 7.5 | `clients/mobile/src/screens/MyRoute.tsx` — today's stops, sequenced |
| 7.6 | `clients/mobile/src/screens/CurrentDelivery.tsx` — address, instructions, action buttons |
| 7.7 | `clients/mobile/src/screens/Deliver.tsx` — camera capture + proprietary signature canvas |
| 7.8 | `clients/mobile/src/services/gps.ts` — 10s GPS poll, offline queue, flush on reconnect |
| 7.9 | `clients/mobile/src/screens/Navigation.tsx` — Leaflet WebView map with driver route |
| 7.10 | `clients/mobile/src/screens/History.tsx` — past deliveries, performance stats |

---

## Week 8: Truck Client + Customer Portal — Task Outline

**Goal:** Truck telemetry streaming; customers can self-serve track shipments.

| Task | Description |
|------|-------------|
| 8.1 | `clients/truck/src/config.ts` — reads config from /etc/pilots/config.json on embedded Linux |
| 8.2 | `clients/truck/src/gps.ts` — reads NMEA sentences from serial port (proprietary NMEA parser) |
| 8.3 | `clients/truck/src/obd.ts` — OBD-II ELM327 protocol over serial (proprietary parser: speed, RPM, fuel) |
| 8.4 | `clients/truck/src/ws-client.ts` — streams telemetry to PILOTS WS server, offline buffer |
| 8.5 | `clients/truck/src/index.ts` — entry point, wires GPS + OBD + WS, configurable interval |
| 8.6 | DB migration: add `truck_telemetry` TimescaleDB hypertable |
| 8.7 | API: PATCH /trucks/:vin/telemetry (authenticated by org API key, not user JWT) |
| 8.8 | `clients/portal/` — React app, separate build, public domain |
| 8.9 | `clients/portal/src/pages/Track.tsx` — shipment number input → GET /tracking/:number → map + timeline |
| 8.10 | `clients/portal/src/pages/TrackingDetail.tsx` — live map (Leaflet), event history, ETA from Predictor |

---

## Self-Review Notes

- All types defined in Task 9 (`PilotsRequest`, `PilotsResponse`, `Handler`, `Middleware`) are used consistently across Tasks 10–14. `params` is assigned in `server.ts` after route match — consistent with `router.ts` `MatchResult.params`.
- `queryOne` returns `T | null` — all callers in `auth.service.ts` check for null before use.
- `rateLimiter` imports `ioredis` — the only allowed Redis client.
- `migrate.ts` and `api/index.ts` both implement `loadEnv()` — this is intentional (each needs to be standalone). Not a DRY violation for this use case since they're separate entry points.
- Week 2–8 task outlines use exact file paths matching the spec's `Project Structure` section.
