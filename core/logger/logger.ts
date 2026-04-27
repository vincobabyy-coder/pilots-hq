type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogContext {
  requestId?: string
  orgId?: string
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
    entry = JSON.stringify({ level, ts: new Date().toISOString(), msg, ...context })
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
