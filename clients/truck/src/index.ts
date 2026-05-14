import { ObdReader } from './obd'
import { GpsReader } from './gps'
import { WsClient } from './ws-client'
import { TelemetryQueue } from './queue'
import { AlertDetector } from './alerts'
import { VehicleTelemetry, BackendMessage, ClientConfig, GeofenceZone } from './types'

class TruckClient {
  private config: ClientConfig
  private obd: ObdReader
  private gps: GpsReader
  private ws: WsClient
  private queue: TelemetryQueue
  private alerts: AlertDetector
  private telemetryInterval: NodeJS.Timeout | null = null
  private syncInterval: NodeJS.Timeout | null = null
  private lastTelemetry: VehicleTelemetry | null = null

  constructor(config: ClientConfig) {
    this.config = {
      telemetryIntervalMs: 5000,
      dbPath: '/tmp/truck_telemetry.db',
      mockMode: true,
      ...config,
    }

    this.obd = new ObdReader(this.config.mockMode)
    this.gps = new GpsReader(this.config.mockMode)
    this.ws = new WsClient(this.config.wsUrl, this.config.vehicleId)
    this.queue = new TelemetryQueue(this.config.dbPath)
    this.alerts = new AlertDetector()

    this.setupWsHandlers()
  }

  async start(): Promise<void> {
    try {
      console.log('[TruckClient] Starting...')
      console.log(`[TruckClient] Vehicle ID: ${this.config.vehicleId}`)
      console.log(`[TruckClient] Mock mode: ${this.config.mockMode}`)

      // Initialize database queue
      await this.queue.initialize()
      console.log('[TruckClient] Queue initialized')

      // Connect to hardware
      await this.obd.connect(this.config.serialPort)
      await this.gps.connect(this.config.serialPort)
      console.log('[TruckClient] Hardware initialized')

      // Connect WebSocket
      try {
        await this.ws.connect()
      } catch (err) {
        console.warn('[TruckClient] WebSocket connection failed, will retry:', err)
        // Continue in offline mode
      }

      // Start telemetry collection
      this.startTelemetryCollection()

      // Start offline sync
      this.startOfflineSync()

      console.log('[TruckClient] Started successfully')
    } catch (err) {
      console.error('[TruckClient] Failed to start:', err)
      throw err
    }
  }

  async stop(): Promise<void> {
    console.log('[TruckClient] Stopping...')

    if (this.telemetryInterval) {
      clearInterval(this.telemetryInterval)
    }

    if (this.syncInterval) {
      clearInterval(this.syncInterval)
    }

    await this.ws.disconnect()
    await this.obd.disconnect()
    await this.gps.disconnect()
    await this.queue.close()

    console.log('[TruckClient] Stopped')
  }

  private setupWsHandlers(): void {
    this.ws.on('connected', () => {
      console.log('[TruckClient] WebSocket connected')
      this.syncQueuedData()
    })

    this.ws.on('disconnected', () => {
      console.log('[TruckClient] WebSocket disconnected')
    })

    this.ws.on('error', (err: Error) => {
      console.error('[TruckClient] WebSocket error:', err.message)
    })

    this.ws.on('message', (msg: BackendMessage) => {
      this.handleBackendMessage(msg)
    })
  }

  private startTelemetryCollection(): void {
    const interval = this.config.telemetryIntervalMs || 5000

    this.telemetryInterval = setInterval(() => {
      this.collectAndSendTelemetry().catch((err) => {
        console.error('[TruckClient] Error collecting telemetry:', err)
      })
    }, interval)
  }

  private async collectAndSendTelemetry(): Promise<void> {
    try {
      const obdReading = await this.obd.readAllPids()
      const gpsLocation = await this.gps.readLocation()

      const telemetry: VehicleTelemetry = {
        vehicleId: this.config.vehicleId,
        timestamp: Date.now(),
        gps: {
          latitude: gpsLocation.latitude,
          longitude: gpsLocation.longitude,
          accuracy: gpsLocation.accuracy,
        },
        speed: obdReading.speed,
        fuel: obdReading.fuelLevel,
        coolantTemp: obdReading.coolantTemp,
        rpm: obdReading.rpm,
        errors: obdReading.errors,
      }

      // Check for alerts
      if (this.lastTelemetry) {
        const brakeAlert = this.alerts.checkHardBraking(telemetry.speed, this.lastTelemetry.speed)
        if (brakeAlert) {
          console.log('[TruckClient] ALERT: Hard braking detected')
          this.ws.sendAlert(brakeAlert)
        }

        const geofenceAlert = this.alerts.checkGeofence(
          this.config.vehicleId,
          telemetry.gps.latitude,
          telemetry.gps.longitude
        )
        if (geofenceAlert) {
          console.log('[TruckClient] ALERT: Geofence violation')
          this.ws.sendAlert(geofenceAlert)
        }
      }

      const maintenanceAlert = this.alerts.checkMaintenance(
        this.config.vehicleId,
        telemetry.fuel,
        telemetry.errors
      )
      if (maintenanceAlert) {
        console.log('[TruckClient] ALERT: Maintenance issue')
        this.ws.sendAlert(maintenanceAlert)
      }

      this.alerts.updateState(telemetry.speed, telemetry.gps.latitude, telemetry.gps.longitude)
      this.lastTelemetry = telemetry

      // Send telemetry
      if (this.ws.isConnected()) {
        this.ws.sendTelemetry(telemetry)
      } else {
        // Queue for later
        await this.queue.enqueue(telemetry)
      }
    } catch (err) {
      console.error('[TruckClient] Telemetry collection error:', err)
    }
  }

  private startOfflineSync(): void {
    this.syncInterval = setInterval(() => {
      if (this.ws.isConnected()) {
        this.syncQueuedData().catch((err) => {
          console.error('[TruckClient] Error syncing queued data:', err)
        })
      }
    }, 30000) // Every 30 seconds
  }

  private async syncQueuedData(): Promise<void> {
    try {
      const queued = await this.queue.getUnsynced(50)

      if (queued.length === 0) {
        return
      }

      console.log(`[TruckClient] Syncing ${queued.length} queued telemetry entries`)

      for (const entry of queued) {
        this.ws.sendTelemetry(entry.data)
      }

      // Mark as synced after sending (ideally after ACK, but for now just after send)
      await this.queue.markSynced(queued.map((e) => e.id))
    } catch (err) {
      console.error('[TruckClient] Sync error:', err)
    }
  }

  private handleBackendMessage(msg: BackendMessage): void {
    switch (msg.type) {
      case 'route_update':
        console.log('[TruckClient] Route update received')
        break

      case 'reroute':
        console.log('[TruckClient] Reroute command received')
        break

      case 'geofence_update':
        console.log('[TruckClient] Geofence update received')
        if ('zones' in msg) {
          this.alerts.updateGeofences(msg.zones as GeofenceZone[])
        }
        break

      case 'heartbeat':
        // Respond with pong
        break

      default:
        console.log('[TruckClient] Unknown message type:', msg.type)
    }
  }
}

// Main execution
async function main() {
  const config: ClientConfig = {
    vehicleId: process.env.VEHICLE_ID || 'TRUCK-001',
    wsUrl: process.env.WS_URL || 'ws://localhost:8080/ws',
    serialPort: process.env.SERIAL_PORT,
    mockMode: process.env.MOCK_MODE !== 'false',
    dbPath: process.env.DB_PATH,
  }

  const client = new TruckClient(config)

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\n[TruckClient] Shutting down...')
    await client.stop()
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  try {
    await client.start()
    console.log('[TruckClient] Truck client is running. Press Ctrl+C to stop.')
  } catch (err) {
    console.error('[TruckClient] Fatal error:', err)
    process.exit(1)
  }
}

main().catch(console.error)
