import { query, queryOne } from '../../core/db/pool'
import { hashPassword, verifyPassword } from '../../core/auth/password'
import { sign, verify } from '../../core/auth/jwt'
import { logger } from '../../core/logger/logger'

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
