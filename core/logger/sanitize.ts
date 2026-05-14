const SENSITIVE_KEYS = new Set([
  'password', 'Password', 'PASSWORD',
  'token', 'Token', 'TOKEN',
  'refreshToken', 'refresh_token', 'RefreshToken',
  'authorization', 'Authorization', 'AUTHORIZATION',
  'api_key', 'apiKey', 'API_KEY',
  'webhook_secret', 'webhookSecret', 'WEBHOOK_SECRET',
  'credit_card', 'creditCard', 'card_number', 'cvv', 'cvc',
  'secret', 'Secret', 'SECRET',
  'private_key', 'privateKey',
  'access_token', 'accessToken',
])

export function sanitizeLogContext(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.has(k)) {
      result[k] = '[REDACTED]'
    } else if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      result[k] = sanitizeLogContext(v as Record<string, unknown>)
    } else {
      result[k] = v
    }
  }
  return result
}
