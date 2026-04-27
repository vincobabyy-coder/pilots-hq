import { WsServer } from '../core/ws/server'

// Singleton WsServer instance shared across the API layer.
// Initialized lazily — call initWsServer() from api/index.ts before first use.
let _wsServer: WsServer | null = null

export function initWsServer(redisUrl?: string): WsServer {
  _wsServer = new WsServer(redisUrl)
  return _wsServer
}

export function getWsServer(): WsServer | null {
  return _wsServer
}
