import { createHmac, createHash } from 'crypto'
import Redis from 'ioredis'
import { logger } from '../logger/logger'

let blacklistRedis: Redis | null = null

function getBlacklistRedis(): Redis {
  if (!blacklistRedis) {
    blacklistRedis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: false,
    })
    blacklistRedis.on('error', (err) =>
      logger.warn('JWT blacklist Redis error', { error: err.message })
    )
  }
  return blacklistRedis
}

export interface JwtPayload {
  sub: string
  org: string
  role: string
  iat: number
  exp: number
}

/** Thrown when a JWT signature is missing, malformed, or does not match. */
export class JsonWebTokenError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'JsonWebTokenError'
  }
}

/** Thrown when a JWT has a valid signature but its `exp` claim is in the past. */
export class TokenExpiredError extends Error {
  constructor() {
    super('Token expired')
    this.name = 'TokenExpiredError'
  }
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

export function sign<T extends Record<string, unknown>>(
  payload: Omit<T, 'iat' | 'exp'>,
  secret: string,
  expiresInSeconds: number
): string {
  const now = Math.floor(Date.now() / 1000)
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = base64url(JSON.stringify({ ...payload, iat: now, exp: now + expiresInSeconds }))
  const sig = hmac(`${header}.${body}`, secret)
  return `${header}.${body}.${sig}`
}

/**
 * Decodes the payload of a JWT without verifying its signature.
 * Used only for introspection — never for authorization decisions.
 * Returns null if the token is malformed.
 */
export function decodeToken(token: string): JwtPayload | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    return JSON.parse(decodeBase64url(parts[1])) as JwtPayload
  } catch {
    return null
  }
}

export function verify<T extends JwtPayload>(token: string, secret: string): T {
  const parts = token.split('.')
  if (parts.length !== 3) throw new JsonWebTokenError('Invalid token format')
  const [header, body, sig] = parts
  const expectedSig = hmac(`${header}.${body}`, secret)
  if (sig !== expectedSig) throw new JsonWebTokenError('Invalid token signature')
  let payload: T
  try {
    payload = JSON.parse(decodeBase64url(body)) as T
  } catch {
    throw new JsonWebTokenError('Token payload could not be decoded')
  }
  if (payload.exp < Math.floor(Date.now() / 1000)) throw new TokenExpiredError()
  return payload
}

/**
 * Add a token to the blacklist.
 * Stores the token fingerprint in Redis with TTL equal to remaining token lifetime.
 * If token is already expired, does nothing (no need to blacklist).
 */
export async function blacklistToken(token: string): Promise<void> {
  try {
    const payload = decodeToken(token)
    if (!payload) return // Malformed, ignore

    const now = Math.floor(Date.now() / 1000)
    const remainingSeconds = payload.exp - now
    if (remainingSeconds <= 0) return // Already expired, no need to blacklist

    const fingerprint = createHash('sha256').update(token).digest('hex').slice(0, 32)
    const key = `jwt:blacklist:${fingerprint}`

    const r = getBlacklistRedis()
    await r.set(key, '1', 'EX', remainingSeconds)
  } catch (err) {
    logger.warn('Failed to blacklist token', { error: (err as Error).message })
    // Swallow; blacklist failures should not crash the request
  }
}

/**
 * Check if a token has been blacklisted.
 * Returns false if Redis is unavailable (fail open).
 */
export async function isBlacklisted(token: string): Promise<boolean> {
  try {
    const payload = decodeToken(token)
    if (!payload) return false // Malformed, not blacklisted

    const fingerprint = createHash('sha256').update(token).digest('hex').slice(0, 32)
    const key = `jwt:blacklist:${fingerprint}`

    const r = getBlacklistRedis()
    const exists = await r.exists(key)
    return exists === 1
  } catch (err) {
    logger.warn('Failed to check blacklist', { error: (err as Error).message })
    return false // Fail open
  }
}
