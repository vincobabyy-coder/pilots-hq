import { haversineKm } from '../route-optimizer/distance-matrix'

interface SpatialEntry {
  shipmentId: string
  lat: number
  lon: number
}

/**
 * Week 3 spatial index implementation.
 *
 * Uses a flat Map keyed by shipmentId with a bounding-box pre-filter and
 * Haversine refinement for findWithinRadius queries. This is correct but
 * O(n) per query — architecturally it mimics an R-tree leaf node with one
 * giant bounding box.
 *
 * Week 5 enhancement: replace with a proper R-tree using recursive spatial
 * partitioning so that findWithinRadius prunes whole subtrees and scales
 * to millions of entries without a full scan.
 */
export class SpatialIndex {
  private entries: Map<string, SpatialEntry> = new Map()

  /** Insert or update a shipment's position */
  upsert(shipmentId: string, lat: number, lon: number): void {
    this.entries.set(shipmentId, { shipmentId, lat, lon })
  }

  /** Remove a shipment from the index */
  remove(shipmentId: string): void {
    this.entries.delete(shipmentId)
  }

  /**
   * Find all shipment IDs within radiusKm of the given point.
   * Uses bounding-box pre-filter then Haversine for precision.
   */
  findWithinRadius(lat: number, lon: number, radiusKm: number): string[] {
    // Bounding box pre-filter (1 degree latitude ≈ 111.2 km)
    const latDelta = radiusKm / 111.2
    const lonDelta = radiusKm / (111.2 * Math.cos((lat * Math.PI) / 180))

    const results: string[] = []
    for (const entry of this.entries.values()) {
      // Fast bbox check first
      if (
        entry.lat < lat - latDelta ||
        entry.lat > lat + latDelta ||
        entry.lon < lon - lonDelta ||
        entry.lon > lon + lonDelta
      )
        continue
      // Precise Haversine check
      if (haversineKm(lat, lon, entry.lat, entry.lon) <= radiusKm) {
        results.push(entry.shipmentId)
      }
    }
    return results
  }

  /** Current number of entries */
  get size(): number {
    return this.entries.size
  }
}
