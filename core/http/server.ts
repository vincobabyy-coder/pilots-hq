import { createServer, IncomingMessage, ServerResponse } from 'http'
import { buildRequest } from './request'
import { buildResponse } from './response'
import { Router } from './router'
import { Middleware, PilotsRequest, PilotsResponse } from './types'
import { logger } from '../logger/logger'

export class PilotsServer {
  private middlewares: Middleware[] = []
  private router = new Router()

  use(middleware: Middleware): this {
    this.middlewares.push(middleware)
    return this
  }

  mount(path: string, router: Router): this {
    this.router.use(path, router)
    return this
  }

  getRouter(): Router {
    return this.router
  }

  private async handle(req: PilotsRequest, res: PilotsResponse): Promise<void> {
    // Build middleware chain ending with router dispatch
    const dispatch = async (): Promise<void> => {
      const match = this.router.match(req.method, req.path)
      if (!match) {
        res.status(404).fail('NOT_FOUND', `Route ${req.method} ${req.path} not found`, 404)
        return
      }
      req.params = match.params
      await match.handler(req, res)
    }

    // Run middleware pipeline
    let i = 0
    const next = async (): Promise<void> => {
      if (i < this.middlewares.length) {
        const mw = this.middlewares[i++]
        await mw(req, res, next)
      } else {
        await dispatch()
      }
    }

    try {
      await next()
    } catch (err) {
      logger.error('Unhandled error in request pipeline', { error: (err as Error).message, path: req.path })
      res.status(500).fail('INTERNAL_ERROR', 'Internal server error', 500)
    }
  }

  listen(port: number, onReady?: () => void): void {
    const server = createServer(async (raw: IncomingMessage, rawRes: ServerResponse) => {
      const req = await buildRequest(raw)
      const res = buildResponse(rawRes, req.requestId)
      await this.handle(req, res)
    })
    server.listen(port, () => {
      logger.info(`PILOTS server listening`, { port })
      onReady?.()
    })
  }
}
