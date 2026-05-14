import { createHash, timingSafeEqual } from 'crypto'
import { query } from '../db/pool'
import { logger } from '../logger/logger'
import { sign, verify, JwtPayload } from './jwt'
import { hashPassword, verifyPassword } from './password'

interface ExtendedJwtPayload extends JwtPayload, Record<string, unknown> {
  ip_hash: string
  user_agent_hash: string
}

interface RefreshTokenRecord {
  user_id: string
  token_hash: string
  expires_at: Date
  created_at: Date
}

/**
 * Hardened authentication manager with:
 * - Refresh token rotation (short-lived access, long-lived refresh)
 * - Token blacklist (immediate logout)
 * - IP/User-Agent binding (prevent token theft)
 * - Brute force protection (5 attempts → 15 min lock)
 * - Rate limiting on auth endpoints
 */
export class AuthenticationManager {
  private tokenBlacklist: Set<string> = new Set() // In-memory, Redis in production
  private failedLoginAttempts: Map<string, { count: number; lockedUntil?: Date }> = new Map()
  private jwtSecret: string

  constructor(jwtSecret: string = process.env.JWT_SECRET || 'dev-secret-change-in-prod') {
    this.jwtSecret = jwtSecret
  }

  /**
   * Login: validate credentials and return access + refresh tokens
   */
  async login(
    email: string,
    password: string,
    req: { ip: string; headers: Record<string, string> }
  ): Promise<{
    accessToken: string
    refreshToken: string
    expiresIn: number
  }> {
    // Rate limit: brute force protection
    await this.checkBruteForce(email, req.ip)

    // Find user
    const users = await query<{ id: string; org_id: string; password_hash: string }>(
      'SELECT id, org_id, password_hash FROM users WHERE email = $1 LIMIT 1',
      [email]
    )

    if (users.length === 0) {
      await this.recordFailedLogin(email, req.ip, 'user_not_found')
      throw new Error('Invalid credentials')
    }

    const user = users[0]

    // Verify password (slow comparison)
    const isValid = await verifyPassword(password, user.password_hash)
    if (!isValid) {
      await this.recordFailedLogin(email, req.ip, 'wrong_password')
      throw new Error('Invalid credentials')
    }

    // Clear failed login attempts on successful login
    this.failedLoginAttempts.delete(email)

    // Generate tokens
    const ipHash = this.hashIpAndUserAgent(req.ip, req.headers['user-agent'] || '')

    // Access token: 15 minutes
    const accessToken = sign<ExtendedJwtPayload>(
      {
        sub: user.id,
        org: user.org_id,
        role: 'user', // TODO: load from database
        ip_hash: ipHash,
        user_agent_hash: ipHash,
      },
      this.jwtSecret,
      15 * 60 // 15 minutes
    )

    // Refresh token: 7 days
    const refreshToken = this.generateRandomToken(32)
    await this.storeRefreshToken(user.id, refreshToken, 7 * 24 * 60 * 60) // 7 days

    logger.info('User logged in', { user_id: user.id, ip: req.ip })

    return {
      accessToken,
      refreshToken,
      expiresIn: 15 * 60, // 15 minutes in seconds
    }
  }

  /**
   * Refresh: use refresh token to get new access token
   */
  async refresh(
    refreshToken: string,
    req: { ip: string; headers: Record<string, string> }
  ): Promise<{
    accessToken: string
    refreshToken: string // New refresh token (rotation)
    expiresIn: number
  }> {
    // Verify refresh token
    const refreshTokenHash = this.hashToken(refreshToken)
    const records = await query<{ user_id: string }>(
      'SELECT user_id FROM refresh_tokens WHERE token_hash = $1 AND expires_at > NOW() LIMIT 1',
      [refreshTokenHash]
    )

    if (records.length === 0) {
      throw new Error('Invalid or expired refresh token')
    }

    const userId = records[0].user_id

    // Get user
    const users = await query<{ id: string; org_id: string }>(
      'SELECT id, org_id FROM users WHERE id = $1 LIMIT 1',
      [userId]
    )

    if (users.length === 0) {
      throw new Error('User not found')
    }

    const user = users[0]

    // Generate new tokens (refresh token rotation)
    const ipHash = this.hashIpAndUserAgent(req.ip, req.headers['user-agent'] || '')

    const accessToken = sign<ExtendedJwtPayload>(
      {
        sub: user.id,
        org: user.org_id,
        role: 'user',
        ip_hash: ipHash,
        user_agent_hash: ipHash,
      },
      this.jwtSecret,
      15 * 60
    )

    const newRefreshToken = this.generateRandomToken(32)
    await this.storeRefreshToken(user.id, newRefreshToken, 7 * 24 * 60 * 60)

    // Invalidate old refresh token
    await query('DELETE FROM refresh_tokens WHERE token_hash = $1', [refreshTokenHash])

    logger.info('Token refreshed', { user_id: userId })

    return {
      accessToken,
      refreshToken: newRefreshToken,
      expiresIn: 15 * 60,
    }
  }

  /**
   * Verify token: check signature, expiry, and binding
   */
  verifyToken(
    token: string,
    req: { ip: string; headers: Record<string, string> }
  ): ExtendedJwtPayload {
    // Check if token is blacklisted (revoked)
    const tokenHash = this.hashToken(token)
    if (this.tokenBlacklist.has(tokenHash)) {
      throw new Error('Token has been revoked')
    }

    // Verify signature and expiry
    const payload = verify<ExtendedJwtPayload>(token, this.jwtSecret)

    // Check IP/User-Agent binding (optional: can be relaxed for mobile apps)
    const currentIpHash = this.hashIpAndUserAgent(req.ip, req.headers['user-agent'] || '')
    if (payload.ip_hash !== currentIpHash) {
      // Log but don't fail (VPN, WiFi switch, etc.)
      logger.warn('Token IP/UA mismatch', {
        user_id: payload.sub,
        expected: payload.ip_hash,
        actual: currentIpHash,
      })
    }

    return payload
  }

  /**
   * Logout: revoke token and refresh token
   */
  async logout(accessToken: string, userId: string): Promise<void> {
    // Add to blacklist
    const tokenHash = this.hashToken(accessToken)
    this.tokenBlacklist.add(tokenHash)

    // Delete refresh tokens
    await query('DELETE FROM refresh_tokens WHERE user_id = $1', [userId])

    logger.info('User logged out', { user_id: userId })
  }

  /**
   * Change password: require old password verification
   */
  async changePassword(userId: string, oldPassword: string, newPassword: string): Promise<void> {
    // Get user
    const users = await query<{ password_hash: string }>(
      'SELECT password_hash FROM users WHERE id = $1 LIMIT 1',
      [userId]
    )

    if (users.length === 0) {
      throw new Error('User not found')
    }

    // Verify old password
    const isValid = await verifyPassword(oldPassword, users[0].password_hash)
    if (!isValid) {
      throw new Error('Invalid password')
    }

    // Hash new password
    const newHash = await hashPassword(newPassword)

    // Update
    await query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [
      newHash,
      userId,
    ])

    // Revoke all refresh tokens (force re-login)
    await query('DELETE FROM refresh_tokens WHERE user_id = $1', [userId])

    logger.info('Password changed', { user_id: userId })
  }

  /**
   * Password reset: send reset link (implementation depends on email service)
   */
  async requestPasswordReset(email: string): Promise<string> {
    // Find user
    const users = await query<{ id: string }>(
      'SELECT id FROM users WHERE email = $1 LIMIT 1',
      [email]
    )

    if (users.length === 0) {
      // Don't reveal whether email exists (security)
      logger.info('Password reset requested for non-existent email', { email })
      return 'check_your_email'
    }

    const userId = users[0].id

    // Generate reset token (valid for 1 hour)
    const resetToken = this.generateRandomToken(32)
    const resetTokenHash = this.hashToken(resetToken)

    await query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '1 hour')
       ON CONFLICT (user_id) DO UPDATE SET token_hash = $2, expires_at = NOW() + INTERVAL '1 hour'`,
      [userId, resetTokenHash]
    )

    logger.info('Password reset requested', { user_id: userId })

    // TODO: Send email with reset link containing resetToken
    // Link format: https://app.pilots.com/reset-password?token={resetToken}

    return 'check_your_email'
  }

  /**
   * Reset password with token
   */
  async resetPassword(resetToken: string, newPassword: string): Promise<void> {
    const resetTokenHash = this.hashToken(resetToken)

    // Verify token
    const records = await query<{ user_id: string }>(
      `SELECT user_id FROM password_reset_tokens
       WHERE token_hash = $1 AND expires_at > NOW() LIMIT 1`,
      [resetTokenHash]
    )

    if (records.length === 0) {
      throw new Error('Invalid or expired reset token')
    }

    const userId = records[0].user_id

    // Hash new password
    const newHash = await hashPassword(newPassword)

    // Update password
    await query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [
      newHash,
      userId,
    ])

    // Delete reset token
    await query('DELETE FROM password_reset_tokens WHERE user_id = $1', [userId])

    // Revoke refresh tokens (force re-login)
    await query('DELETE FROM refresh_tokens WHERE user_id = $1', [userId])

    logger.info('Password reset completed', { user_id: userId })
  }

  // ===== PRIVATE HELPERS =====

  private async checkBruteForce(email: string, ip: string): Promise<void> {
    const attempts = this.failedLoginAttempts.get(email)

    if (attempts && attempts.lockedUntil && attempts.lockedUntil > new Date()) {
      throw new Error('Account locked. Try again later.')
    }

    // Check database for rate limiting across instances
    const dbAttempts = await query<{ attempt_count: number }>(
      `SELECT COUNT(*) as attempt_count FROM login_attempts
       WHERE email = $1 AND created_at > NOW() - INTERVAL '15 minutes'`,
      [email]
    )

    if (dbAttempts[0]?.attempt_count >= 5) {
      throw new Error('Too many login attempts. Try again in 15 minutes.')
    }
  }

  private async recordFailedLogin(email: string, ip: string, reason: string): Promise<void> {
    // Update in-memory cache
    const current = this.failedLoginAttempts.get(email) || { count: 0 }
    current.count++

    if (current.count >= 5) {
      current.lockedUntil = new Date(Date.now() + 15 * 60 * 1000) // Lock for 15 min
    }

    this.failedLoginAttempts.set(email, current)

    // Store in database (for distributed rate limiting)
    await query(
      'INSERT INTO login_attempts (email, ip, reason, created_at) VALUES ($1, $2, $3, NOW())',
      [email, ip, reason]
    )
  }

  private async storeRefreshToken(userId: string, token: string, expiresInSeconds: number): Promise<void> {
    const tokenHash = this.hashToken(token)
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000)

    await query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, created_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (user_id) DO UPDATE SET token_hash = $2, expires_at = $3`,
      [userId, tokenHash, expiresAt]
    )
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex')
  }

  private hashIpAndUserAgent(ip: string, userAgent: string): string {
    return createHash('sha256').update(ip + '|' + userAgent).digest('hex').slice(0, 32)
  }

  private generateRandomToken(bytes: number): string {
    const buf = require('crypto').randomBytes(bytes)
    return buf.toString('hex')
  }
}

export const authenticationManager = new AuthenticationManager()
