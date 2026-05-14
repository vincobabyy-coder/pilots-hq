import { EventEmitter } from 'events'
import { AlertEvent, GeofenceZone } from './types'
import { GpsReader } from './gps'

export class AlertDetector extends EventEmitter {
  private geofences: Map<string, GeofenceZone> = new Map()
  private lastSpeed: number = 0
  private lastGpsLat: number = 0
  private lastGpsLng: number = 0
  private lastCheckTime: number = Date.now()

  updateGeofences(zones: GeofenceZone[]): void {
    this.geofences.clear()
    zones.forEach((zone) => {
      this.geofences.set(zone.id, zone)
    })
  }

  checkHardBraking(currentSpeed: number, prevSpeed: number): AlertEvent | null {
    // Detect hard braking: deceleration > 0.5g (~5 m/s^2 or ~18 km/h drop per second)
    // Use a minimum time delta to avoid division issues
    const timeDeltaSeconds = Math.max((Date.now() - this.lastCheckTime) / 1000, 0.1)

    const speedDeltaKmh = currentSpeed - prevSpeed // km/h
    const speedDeltaMs = (speedDeltaKmh * 1000) / 3600 // convert km/h to m/s
    const deceleration = Math.abs(speedDeltaMs / timeDeltaSeconds) // m/s^2

    const HARD_BRAKE_THRESHOLD = 5.0 // m/s^2

    if (deceleration > HARD_BRAKE_THRESHOLD && prevSpeed > 10) {
      return {
        type: 'hard_brake',
        vehicleId: '', // Set by caller
        timestamp: Date.now(),
        severity: 'warning',
        message: `Hard braking detected: ${deceleration.toFixed(2)} m/s^2`,
        data: {
          deceleration: deceleration,
          speedBefore: prevSpeed,
          speedAfter: currentSpeed,
        },
      }
    }

    return null
  }

  checkGeofence(vehicleId: string, lat: number, lng: number): AlertEvent | null {
    for (const zone of this.geofences.values()) {
      const distance = GpsReader.calculateDistance(lat, lng, zone.latitude, zone.longitude)

      if (distance > zone.radiusKm && zone.alertOnViolation) {
        return {
          type: 'geofence',
          vehicleId: vehicleId,
          timestamp: Date.now(),
          severity: 'info',
          message: `Vehicle outside geofence: ${zone.name}`,
          data: {
            fenceId: zone.id,
            distance: distance,
            radiusKm: zone.radiusKm,
          },
        }
      }
    }

    return null
  }

  checkMaintenance(vehicleId: string, fuelLevel: number, errorCodes: string[]): AlertEvent | null {
    const FUEL_LOW_THRESHOLD = 20 // percent

    if (fuelLevel < FUEL_LOW_THRESHOLD) {
      return {
        type: 'maintenance',
        vehicleId: vehicleId,
        timestamp: Date.now(),
        severity: 'warning',
        message: `Low fuel level: ${fuelLevel.toFixed(1)}%`,
        data: {
          fuelLevel: fuelLevel,
        },
      }
    }

    if (errorCodes.length > 0) {
      return {
        type: 'maintenance',
        vehicleId: vehicleId,
        timestamp: Date.now(),
        severity: 'warning',
        message: `Engine error codes detected: ${errorCodes.join(', ')}`,
        data: {
          dtcCodes: errorCodes,
        },
      }
    }

    return null
  }

  updateState(speed: number, lat: number, lng: number): void {
    this.lastSpeed = speed
    this.lastGpsLat = lat
    this.lastGpsLng = lng
    this.lastCheckTime = Date.now()
  }
}
