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
