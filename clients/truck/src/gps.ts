import { EventEmitter } from 'events'

export interface GpsLocation {
  latitude: number
  longitude: number
  accuracy?: number
  timestamp: number
}

export class GpsReader extends EventEmitter {
  private mockMode: boolean
  private isConnected: boolean = false
  private lastLocation: GpsLocation | null = null

  constructor(mockMode: boolean = true) {
    super()
    this.mockMode = mockMode
  }

  async connect(serialPort?: string): Promise<void> {
    if (this.mockMode) {
      this.isConnected = true
      return
    }

    // In a real implementation, initialize GPS device
    this.isConnected = true
  }

  async disconnect(): Promise<void> {
    this.isConnected = false
  }

  async readLocation(): Promise<GpsLocation> {
    if (!this.isConnected) {
      throw new Error('GPS not connected')
    }

    if (this.mockMode) {
      return this.generateMockLocation()
    }

    // Real GPS implementation would go here
    return this.lastLocation || this.generateMockLocation()
  }

  private generateMockLocation(): GpsLocation {
    // Simulate Lagos coordinates with small random variation
    const baseLat = 6.5244
    const baseLng = 3.3792
    const variance = 0.001 // ~100m variance

    return {
      latitude: baseLat + (Math.random() - 0.5) * variance,
      longitude: baseLng + (Math.random() - 0.5) * variance,
      accuracy: Math.random() * 5 + 5, // 5-10m
      timestamp: Date.now(),
    }
  }

  // Calculate distance between two points in km using Haversine formula
  static calculateDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
  ): number {
    const R = 6371 // Earth's radius in km
    const dLat = ((lat2 - lat1) * Math.PI) / 180
    const dLon = ((lon2 - lon1) * Math.PI) / 180
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    return R * c
  }
}
