import { createHmac } from 'crypto'

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

export function verify(token: string, secret: string): JwtPayload {
  const parts = token.split('.')
  if (parts.length !== 3) throw new JsonWebTokenError('Invalid token format')
  const [header, body, sig] = parts
  const expectedSig = hmac(`${header}.${body}`, secret)
  if (sig !== expectedSig) throw new JsonWebTokenError('Invalid token signature')
  let payload: JwtPayload
  try {
    payload = JSON.parse(decodeBase64url(body)) as JwtPayload
  } catch {
    throw new JsonWebTokenError('Token payload could not be decoded')
  }
  if (payload.exp < Math.floor(Date.now() / 1000)) throw new TokenExpiredError()
  return payload
}
