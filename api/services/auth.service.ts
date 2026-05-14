import { query, queryOne } from '../../core/db/pool'
import { hashPassword, verifyPassword } from '../../core/auth/password'
import { sign, verify } from '../../core/auth/jwt'
import { logger } from '../../core/logger/logger'
import { encryptField, decryptField, getEncryptionKey } from '../../core/crypto/field-encryption'
import { auditLogger } from '../../core/audit/audit-logger'
import Redis from 'ioredis'

const MAX_FAILED_ATTEMPTS = 5
const LOCKOUT_SECONDS = 900 // 15 minutes

let lockoutRedis: Redis | null = null

function getLockoutRedis(): Redis {
  if (!lockoutRedis) {
    lockoutRedis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      enableOfflineQueue: false,
    })
    lockoutRedis.on('error', (err) => {
      logger.warn('Lockout Redis unavailable — brute-force protection skipped', { error: err.message })
    })
  }
  return lockoutRedis
}

function lockoutKey(email: string): string {
  return `login_attempts:${email.toLowerCase().trim()}`
}

async function checkLockout(email: string): Promise<void> {
  try {
    const r = getLockoutRedis()
    const count = await r.get(lockoutKey(email))
    if (count !== null && parseInt(count, 10) >= MAX_FAILED_ATTEMPTS) {
      throw new Error('Account temporarily locked. Try again in 15 minutes.')
    }
  } catch (err) {
    if ((err as Error).message.includes('locked')) throw err
    // Redis unavailable — fail open, log and continue
    logger.warn('Lockout check skipped: Redis unavailable', { email: email.replace(/.{4}/, '****') })
  }
}

async function recordFailedAttempt(email: string): Promise<void> {
  try {
    const r = getLockoutRedis()
    const key = lockoutKey(email)
    const result = await r.incr(key)
    if (result === 1) {
      // Only set expiry on first attempt so the window isn't reset by each failure
      await r.expire(key, LOCKOUT_SECONDS)
    }
    // Also increment the hourly security metric counter
    const metricKey = 'pilots:metrics:failed_logins:1h'
    const metricCount = await r.incr(metricKey)
    if (metricCount === 1) await r.expire(metricKey, 3600)
  } catch {
    // Redis unavailable — fail open
  }
}

async function clearLockout(email: string): Promise<void> {
  try {
    const r = getLockoutRedis()
    await r.del(lockoutKey(email))
  } catch {
    // Redis unavailable — fail open
  }
}

interface UserRow extends Record<string, unknown> {
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

export interface ActorContext {
  actorId?: string
  actorEmail?: string
  ipAddress?: string
  userAgent?: string
}

const ACCESS_TTL = 3600         // 1 hour
const REFRESH_TTL = 7 * 86400  // 7 days

export async function login(
  email: string,
  password: string,
  ctx: ActorContext = {}
): Promise<AuthTokens> {
  // Check lockout BEFORE hitting the database (fail fast)
  await checkLockout(email)

  const user = await queryOne<UserRow>(
    'SELECT id, org_id, email, password_hash, name, role FROM users WHERE email = $1',
    [email.toLowerCase().trim()]
  )
  if (!user) {
    await recordFailedAttempt(email)
    throw new Error('Invalid credentials')
  }
  if (!verifyPassword(password, user.password_hash)) {
    await recordFailedAttempt(email)
    throw new Error('Invalid credentials')
  }

  // Successful login — clear any lockout counter
  await clearLockout(email)

  const secret = process.env.JWT_SECRET!
  const refreshSecret = process.env.JWT_REFRESH_SECRET!

  const accessToken = sign({ sub: user.id, org: user.org_id, role: user.role }, secret, ACCESS_TTL)
  const refreshToken = sign({ sub: user.id, org: user.org_id, role: user.role }, refreshSecret, REFRESH_TTL)

  logger.info('User logged in', { userId: user.id, orgId: user.org_id })

  await auditLogger.logMutation({
    orgId: user.org_id,
    actorId: user.id,
    actorEmail: user.email,
    action: 'user.login',
    resource: 'user',
    resourceId: user.id,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  })

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

export async function createOrg(
  name: string,
  slug: string,
  apiKey?: string,
  webhookSecret?: string
): Promise<{ id: string }> {
  const key = process.env.ENCRYPTION_KEY ? getEncryptionKey() : null

  const apiKeyEncrypted = apiKey && key ? encryptField(apiKey, key) : null
  const webhookSecretEncrypted = webhookSecret && key ? encryptField(webhookSecret, key) : null

  const rows = await query<{ id: string }>(
    `INSERT INTO organizations (name, slug, api_key_encrypted, webhook_secret_encrypted_v2)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [name, slug, apiKeyEncrypted, webhookSecretEncrypted]
  )
  return rows[0]
}

export async function getOrgApiKey(orgId: string): Promise<string | null> {
  const row = await queryOne<{ api_key_encrypted: string | null }>(
    'SELECT api_key_encrypted FROM organizations WHERE id = $1',
    [orgId]
  )
  if (!row?.api_key_encrypted) return null
  const key = getEncryptionKey()
  return decryptField(row.api_key_encrypted, key)
}

export async function createUser(
  orgId: string,
  email: string,
  password: string,
  name: string,
  role: string,
  ctx: ActorContext = {}
): Promise<{ id: string }> {
  const hash = hashPassword(password)
  const rows = await query<{ id: string }>(
    'INSERT INTO users (org_id, email, password_hash, name, role) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [orgId, email.toLowerCase().trim(), hash, name, role]
  )
  const newUserId = rows[0].id

  await auditLogger.logMutation({
    orgId,
    actorId: ctx.actorId,
    actorEmail: ctx.actorEmail,
    action: 'user.created',
    resource: 'user',
    resourceId: newUserId,
    newValues: { email: email.toLowerCase().trim(), role, name },
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  })

  return rows[0]
}
