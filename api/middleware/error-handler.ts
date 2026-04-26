import { Middleware } from '../../core/http/types'
import { logger } from '../../core/logger/logger'

export const errorHandler: Middleware = async (req, res, next) => {
  try {
    await next()
  } catch (err) {
    logger.error('Unhandled route error', {
      requestId: req.requestId,
      path: req.path,
      error: (err as Error).message,
      stack: (err as Error).stack,
    })
    res.status(500).fail('INTERNAL_ERROR', 'An unexpected error occurred', 500)
  }
}
