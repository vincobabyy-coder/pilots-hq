// tests/run-all.ts
import { run } from './runner'

// Test files are imported here — each registers its tests on import.
// Add each new test file below as it is created.
import './core/logger.test'
import './core/validation.test'

run().then(code => process.exit(code)).catch(() => process.exit(1))
