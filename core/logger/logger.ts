import { sanitizeLogContext } from './sanitize'

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogContext {
  requestId?:  string
  orgId?:      string
  userId?:     string
  shipmentId?: string
  routeId?:    string
  [key: string]: unknown
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 }

function getConfiguredLevel(): LogLevel {
  const raw = process.env.LOG_LEVEL?.toLowerCase()
  if (raw && raw in LEVEL_ORDER) return raw as LogLevel
  return 'info'
}

function log(level: LogLevel, msg: string, context: LogContext = {}): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[getConfiguredLevel()]) return
  let entry: string
  try {
    const safe = sanitizeLogContext(context as Record<string, unknown>)
    entry = JSON.stringify({ level, ts: new Date().toISOString(), msg, ...safe })
  } catch {
    entry = JSON.stringify({ level, ts: new Date().toISOString(), msg, _serializeError: true })
  }
  const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout
  stream.write(entry + '\n')
}

export const logger = {
  debug: (msg: string, ctx?: LogContext) => log('debug', msg, ctx),
  info:  (msg: string, ctx?: LogContext) => log('info',  msg, ctx),
  warn:  (msg: string, ctx?: LogContext) => log('warn',  msg, ctx),
  error: (msg: string, ctx?: LogContext) => log('error', msg, ctx),
}

/**
 * Returns a child logger that merges `context` into every log call.
 * Use this inside route handlers / services so every entry automatically
 * carries requestId, orgId, userId, etc. without repeating them.
 */
export function createContextLogger(context: LogContext): typeof logger {
  return {
    debug: (msg: string, ctx?: LogContext) => log('debug', msg, { ...context, ...ctx }),
    info:  (msg: string, ctx?: LogContext) => log('info',  msg, { ...context, ...ctx }),
    warn:  (msg: string, ctx?: LogContext) => log('warn',  msg, { ...context, ...ctx }),
    error: (msg: string, ctx?: LogContext) => log('error', msg, { ...context, ...ctx }),
  }
}
