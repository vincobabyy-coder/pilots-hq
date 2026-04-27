export type TrackingEventType =
  | 'created'
  | 'allocated'
  | 'in_transit'
  | 'location_updated'
  | 'out_for_delivery'
  | 'delivered'
  | 'failed_delivery'
  | 'exception'
  | 'cancelled'

export interface TrackingEvent {
  id: string
  shipmentId: string
  eventType: TrackingEventType
  eventStatus?: string
  lat?: number
  lon?: number
  details?: Record<string, unknown>
  createdAt: Date
}

export interface ShipmentState {
  shipmentId: string
  status: TrackingEventType
  lastLat?: number
  lastLon?: number
  lastUpdatedAt: Date
  eventCount: number
  isLate: boolean
  isException: boolean
  deliveredAt?: Date
}
