import { createServer, IncomingMessage, Server, ServerResponse } from 'http'
import { buildRequest } from './request'
import { buildResponse } from './response'
import { Router } from './router'
import { Middleware, PilotsRequest, PilotsResponse } from './types'
import { logger } from '../logger/logger'

export class PilotsServer {
  private middlewares: Middleware[] = []
  private router = new Router()
  private _httpServer: Server | null = null

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

  /**
   * Creates the underlying http.Server without binding to a port.
   * Call this before listen() when you need to attach WebSocket upgrade
   * handlers (or other server-level listeners) prior to accepting connections.
   * Calling listen() will reuse the server created here.
   */
  initHttpServer(): Server {
    if (!this._httpServer) {
      this._httpServer = createServer(async (raw: IncomingMessage, rawRes: ServerResponse) => {
        const req = await buildRequest(raw)
        const res = buildResponse(rawRes, req.requestId)
        await this.handle(req, res)
      })
    }
    return this._httpServer
  }

  /** Exposes the underlying http.Server after initHttpServer() or listen() has been called. */
  get httpServer(): Server {
    if (!this._httpServer) {
      throw new Error('httpServer is not available before initHttpServer() or listen() is called')
    }
    return this._httpServer
  }

  listen(port: number, onReady?: () => void): void {
    // Reuse the server created by initHttpServer() if already called; otherwise create it now.
    const server = this.initHttpServer()
    server.listen(port, () => {
      logger.info(`PILOTS server listening`, { port })
      onReady?.()
    })
  }
}
