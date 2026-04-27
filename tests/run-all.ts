import { run } from './runner'
import './core/logger.test'
import './core/validation.test'
import './core/jwt.test'
import './core/password.test'
import './core/db.test'
import './core/router.test'
import './integration/auth.test'
import './engines/distance-matrix.test'
import './engines/greedy-init.test'
import './engines/vrp.test'

run().then(code => process.exit(code)).catch(() => process.exit(1))
