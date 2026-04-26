// tests/run-all.ts
import { run } from './runner'
import './core/logger.test'
import './core/validation.test'
import './core/jwt.test'
import './core/password.test'
import './core/db.test'
import './core/router.test'

run().then(code => process.exit(code)).catch(() => process.exit(1))
