import { logger } from '../logger/logger'

/**
 * Error Handler: Prevents information disclosure to clients
 *
 * CRITICAL: Never expose:
 * - Stack traces
 * - Database query details
 * - Internal API calls
 * - System paths
 * - Sensitive data (phone, email, addresses)
 */

export interface ApiError {
  statusCode: number
  message: string
  code: string
  timestamp: string
}

export class AppError extends Error {
  constructor(
    public statusCode: number = 500,
    message: string = 'Internal server error',
    public code: string = 'INTERNAL_ERROR'
  ) {
    super(message)
    this.name = 'AppError'
  }
}

/**
 * Safe error response for API (no sensitive details)
 */
export function createErrorResponse(error: unknown, requestId?: string): ApiError {
  let statusCode = 500
  let message = 'An error occurred'
  let code = 'INTERNAL_ERROR'

  if (error instanceof AppError) {
    statusCode = error.statusCode
    message = error.message
    code = error.code
  } else if (error instanceof Error) {
    // Don't expose error message for generic errors
    message = 'An error occurred'
    code = 'INTERNAL_ERROR'

    // Log the actual error internally
    logger.error('Unexpected error', {
      error: error.message,
      stack: error.stack,
      requestId,
    })
  } else {
    logger.error('Unknown error', { error, requestId })
  }

  return {
    statusCode,
    message,
    code,
    timestamp: new Date().toISOString(),
  }
}

/**
 * HTTP error factory
 */
export const Errors = {
  BadRequest: (message: string) => new AppError(400, message, 'BAD_REQUEST'),
  Unauthorized: () => new AppError(401, 'Unauthorized', 'UNAUTHORIZED'),
  Forbidden: () => new AppError(403, 'Access denied', 'FORBIDDEN'),
  NotFound: () => new AppError(404, 'Resource not found', 'NOT_FOUND'),
  Conflict: (message: string) => new AppError(409, message, 'CONFLICT'),
  Unprocessable: (message: string) => new AppError(422, message, 'UNPROCESSABLE_ENTITY'),
  TooManyRequests: () => new AppError(429, 'Too many requests', 'RATE_LIMITED'),
  InternalError: (message: string = 'Internal server error') =>
    new AppError(500, message, 'INTERNAL_ERROR'),
}

/**
 * Sanitize user input to prevent injection attacks
 */
export function sanitizeInput(input: unknown): unknown {
  if (typeof input === 'string') {
    // Remove null bytes (can break database queries)
    if (input.includes('\0')) {
      throw Errors.BadRequest('Invalid input: null bytes not allowed')
    }

    // Limit length to prevent buffer overflows
    if (input.length > 10000) {
      throw Errors.BadRequest('Input too long')
    }

    return input.trim()
  }

  if (typeof input === 'object' && input !== null) {
    if (Array.isArray(input)) {
      return input.map(sanitizeInput)
    }

    const sanitized: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(input)) {
      // Prevent prototype pollution
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        continue
      }

      sanitized[key] = sanitizeInput(value)
    }

    return sanitized
  }

  return input
}

/**
 * Mask sensitive data from logs
 */
export function maskSensitiveData(obj: Record<string, unknown>): Record<string, unknown> {
  const sensitiveFields = ['password', 'token', 'secret', 'api_key', 'access_token', 'refresh_token', 'phone', 'email', 'ssn', 'credit_card']

  const masked: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase()

    if (sensitiveFields.some((field) => lowerKey.includes(field))) {
      if (typeof value === 'string') {
        masked[key] = `***${value.slice(-4)}`
      } else {
        masked[key] = '***'
      }
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      masked[key] = maskSensitiveData(value as Record<string, unknown>)
    } else {
      masked[key] = value
    }
  }

  return masked
}

/**
 * Async error wrapper for Express handlers
 */
export function asyncHandler(fn: (req: any, res: any, next: any) => Promise<any>) {
  return (req: any, res: any, next: any) => {
    Promise.resolve(fn(req, res, next)).catch(next)
  }
}

/**
 * Validation error factory
 */
export function validateRequired(value: unknown, fieldName: string): void {
  if (value === undefined || value === null || value === '') {
    throw Errors.BadRequest(`${fieldName} is required`)
  }
}

export function validateEmail(email: string): void {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(email)) {
    throw Errors.BadRequest('Invalid email format')
  }
}

export function validatePhoneNumber(phone: string): void {
  const phoneRegex = /^\+?[\d\s-()]{10,}$/
  if (!phoneRegex.test(phone.replace(/\s/g, ''))) {
    throw Errors.BadRequest('Invalid phone number')
  }
}

export function validatePasswordStrength(password: string): void {
  if (password.length < 12) {
    throw Errors.BadRequest('Password must be at least 12 characters')
  }

  const hasUppercase = /[A-Z]/.test(password)
  const hasLowercase = /[a-z]/.test(password)
  const hasNumber = /\d/.test(password)
  const hasSpecial = /[!@#$%^&*]/.test(password)

  if (!hasUppercase || !hasLowercase || !hasNumber || !hasSpecial) {
    throw Errors.BadRequest(
      'Password must contain uppercase, lowercase, number, and special character'
    )
  }
}
