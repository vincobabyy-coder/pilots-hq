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

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null) return false
  if (typeof a !== typeof b) return false
  if (typeof a !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    return a.every((item, i) => deepEqual(item, (b as unknown[])[i]))
  }
  const aObj = a as Record<string, unknown>
  const bObj = b as Record<string, unknown>
  const aKeys = Object.keys(aObj)
  const bKeys = Object.keys(bObj)
  if (aKeys.length !== bKeys.length) return false
  return aKeys.every(key => Object.prototype.hasOwnProperty.call(bObj, key) && deepEqual(aObj[key], bObj[key]))
}

class AssertionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AssertionError'
  }
}

export class Expect {
  constructor(private value: unknown) {}

  toBe(expected: unknown): void {
    if (this.value !== expected) {
      throw new AssertionError(`Expected ${JSON.stringify(this.value)} to be ${JSON.stringify(expected)}`)
    }
  }

  toEqual(expected: unknown): void {
    if (!deepEqual(this.value, expected)) {
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
    if (this.value == null || typeof (this.value as { length?: number }).length !== 'number') {
      throw new AssertionError(`toHaveLength requires array, string, or object with .length`)
    }
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
      thrownMessage = e instanceof Error ? e.message : String(e)
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
      thrownMessage = e instanceof Error ? e.message : String(e)
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
