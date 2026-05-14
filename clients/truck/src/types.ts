// Telemetry data from vehicle
export interface VehicleTelemetry {
  vehicleId: string
  timestamp: number
  gps: {
    latitude: number
    longitude: number
    accuracy?: number
  }
  speed: number // km/h
  fuel: number // liters (0-100 as percentage if unavailable)
  coolantTemp: number // celsius
  rpm: number
  errors: string[] // DTC codes
}

// Alert event sent to backend
export interface AlertEvent {
  type: 'hard_brake' | 'geofence' | 'maintenance' | 'error'
  vehicleId: string
  timestamp: number
  severity: 'info' | 'warning' | 'critical'
  message: string
  data?: {
    deceleration?: number
    fenceId?: string
    dtcCode?: string
    [key: string]: unknown
  }
}

// Inbound WebSocket message from backend
export interface BackendMessage {
  type: 'route_update' | 'reroute' | 'geofence_update' | 'heartbeat' | 'ack'
  [key: string]: unknown
}

// Outbound WebSocket message to backend
export interface ClientMessage {
  type: 'truck_telemetry' | 'alert' | 'register' | 'pong'
  vehicleId?: string
  [key: string]: unknown
}

// Geofence zone
export interface GeofenceZone {
  id: string
  name: string
  latitude: number
  longitude: number
  radiusKm: number
  alertOnViolation: boolean
}

// Queued telemetry entry for offline sync
export interface QueuedTelemetry {
  id: number
  data: VehicleTelemetry
  createdAt: number
  synced: boolean
}

// Configuration
export interface ClientConfig {
  vehicleId: string
  wsUrl: string
  serialPort?: string // e.g., "/dev/ttyUSB0"
  mockMode?: boolean
  dbPath?: string
  telemetryIntervalMs?: number
}
