import { EventEmitter } from 'events'
import * as WebSocket from 'ws'
import { VehicleTelemetry, ClientMessage, BackendMessage, AlertEvent } from './types'

interface RetryConfig {
  maxRetries: number
  initialDelayMs: number
  maxDelayMs: number
  backoffMultiplier: number
}

export class WsClient extends EventEmitter {
  private ws: WebSocket.WebSocket | null = null
  private url: string
  private vehicleId: string
  private connected: boolean = false
  private retryCount: number = 0
  private retryTimer: NodeJS.Timeout | null = null
  private retryConfig: RetryConfig
  private heartbeatTimer: NodeJS.Timeout | null = null
  private lastHeartbeatTime: number = Date.now()

  constructor(
    url: string,
    vehicleId: string,
    retryConfig?: Partial<RetryConfig>
  ) {
    super()
    this.url = url
    this.vehicleId = vehicleId
    this.retryConfig = {
      maxRetries: 10,
      initialDelayMs: 1000,
      maxDelayMs: 30000,
      backoffMultiplier: 1.5,
      ...retryConfig,
    }
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket.WebSocket(this.url)

        this.ws.on('open', () => {
          this.connected = true
          this.retryCount = 0
          this.emit('connected')
          this.startHeartbeat()
          this.sendRegister()
          console.log('[WsClient] Connected to', this.url)
          resolve()
        })

        this.ws.on('message', (data: WebSocket.Data) => {
          try {
            const message = JSON.parse(data.toString()) as BackendMessage
            this.emit('message', message)
          } catch (err) {
            console.error('[WsClient] Failed to parse message:', err)
          }
        })

        this.ws.on('error', (err: Error) => {
          console.error('[WsClient] WebSocket error:', err.message)
          this.emit('error', err)
        })

        this.ws.on('close', () => {
          this.connected = false
          this.stopHeartbeat()
          this.emit('disconnected')
          console.log('[WsClient] Disconnected from', this.url)
          this.scheduleReconnect()
        })

        // Set a timeout for connection
        setTimeout(() => {
          if (!this.connected) {
            reject(new Error('Connection timeout'))
            if (this.ws) {
              this.ws.close()
            }
          }
        }, 5000)
      } catch (err) {
        reject(err)
      }
    })
  }

  private scheduleReconnect(): void {
    if (this.retryCount >= this.retryConfig.maxRetries) {
      console.error('[WsClient] Max retries exceeded, stopping reconnection attempts')
      this.emit('max_retries_exceeded')
      return
    }

    const delayMs = Math.min(
      this.retryConfig.initialDelayMs * Math.pow(this.retryConfig.backoffMultiplier, this.retryCount),
      this.retryConfig.maxDelayMs
    )

    console.log(
      `[WsClient] Reconnecting in ${delayMs}ms (attempt ${this.retryCount + 1}/${this.retryConfig.maxRetries})`
    )

    this.retryTimer = setTimeout(() => {
      this.retryCount++
      this.connect().catch((err) => {
        console.error('[WsClient] Reconnection failed:', err.message)
      })
    }, delayMs)
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      if (this.connected && this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.ping()
        this.lastHeartbeatTime = Date.now()
      }
    }, 30000) // Every 30 seconds
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private sendRegister(): void {
    const msg: ClientMessage = {
      type: 'register',
      vehicleId: this.vehicleId,
    }
    this.send(msg)
  }

  send(message: ClientMessage): void {
    if (!this.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('[WsClient] Cannot send: not connected')
      return
    }

    try {
      this.ws.send(JSON.stringify(message))
    } catch (err) {
      console.error('[WsClient] Failed to send message:', err)
    }
  }

  sendTelemetry(telemetry: VehicleTelemetry): void {
    const msg: any = {
      type: 'truck_telemetry',
      ...telemetry,
    }
    this.send(msg)
  }

  sendAlert(alert: AlertEvent): void {
    const msg: any = {
      type: 'alert',
      severity: alert.severity,
      message: alert.message,
      timestamp: alert.timestamp,
      vehicleId: alert.vehicleId,
      alertType: alert.type,
      data: alert.data,
    }
    this.send(msg)
  }

  async disconnect(): Promise<void> {
    this.stopHeartbeat()

    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
    }

    return new Promise((resolve) => {
      if (this.ws) {
        this.ws.on('close', () => {
          this.connected = false
          resolve()
        })
        this.ws.close(1000, 'Client disconnect')
      } else {
        this.connected = false
        resolve()
      }
    })
  }

  isConnected(): boolean {
    return this.connected
  }
}
