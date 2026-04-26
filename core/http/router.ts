import { Handler } from './types'

interface RouteEntry {
  method: string
  segments: string[]
  handler: Handler
}

interface MatchResult {
  handler: Handler
  params: Record<string, string>
}

export class Router {
  private routes: RouteEntry[] = []
  private subRouters: Array<{ prefix: string; router: Router }> = []

  private addRoute(method: string, path: string, handler: Handler): void {
    const segments = path.split('/').filter(Boolean)
    this.routes.push({ method: method.toUpperCase(), segments, handler })
  }

  get(path: string, handler: Handler): this { this.addRoute('GET', path, handler); return this }
  post(path: string, handler: Handler): this { this.addRoute('POST', path, handler); return this }
  put(path: string, handler: Handler): this { this.addRoute('PUT', path, handler); return this }
  patch(path: string, handler: Handler): this { this.addRoute('PATCH', path, handler); return this }
  delete(path: string, handler: Handler): this { this.addRoute('DELETE', path, handler); return this }

  use(prefix: string, router: Router): this {
    this.subRouters.push({ prefix, router })
    return this
  }

  match(method: string, path: string): MatchResult | null {
    const incomingSegments = path.split('/').filter(Boolean)

    // Check sub-routers first
    for (const { prefix, router } of this.subRouters) {
      const prefixSegments = prefix.split('/').filter(Boolean)
      if (path.startsWith(prefix)) {
        const remainingPath = '/' + incomingSegments.slice(prefixSegments.length).join('/')
        const result = router.match(method, remainingPath)
        if (result) return result
      }
    }

    // Check own routes
    for (const route of this.routes) {
      if (route.method !== method.toUpperCase()) continue
      if (route.segments.length !== incomingSegments.length) continue

      const params: Record<string, string> = {}
      let matched = true

      for (let i = 0; i < route.segments.length; i++) {
        const routeSeg = route.segments[i]
        const incomingSeg = incomingSegments[i]

        if (routeSeg.startsWith(':')) {
          params[routeSeg.slice(1)] = incomingSeg
        } else if (routeSeg !== incomingSeg) {
          matched = false
          break
        }
      }

      if (matched) return { handler: route.handler, params }
    }

    return null
  }
}
