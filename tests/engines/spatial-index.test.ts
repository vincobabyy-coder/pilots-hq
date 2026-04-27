import { describe, it, expect } from '../runner'
import { SpatialIndex } from '../../engines/tracking/spatial-index'

describe('SpatialIndex', () => {
  it('empty index returns empty results', () => {
    const index = new SpatialIndex()
    const results = index.findWithinRadius(0, 0, 10)
    expect(results).toEqual([])
  })

  it('size reflects upserted entries', () => {
    const index = new SpatialIndex()
    index.upsert('shp-1', 6.5244, 3.3792)
    index.upsert('shp-2', 6.4550, 3.3841)
    index.upsert('shp-3', 6.6018, 3.3515)
    expect(index.size).toBe(3)
  })

  it('upsert is idempotent — updating same id does not grow size', () => {
    const index = new SpatialIndex()
    index.upsert('shp-1', 6.5244, 3.3792)
    index.upsert('shp-1', 6.5300, 3.3800) // update same shipment
    expect(index.size).toBe(1)
  })

  it('finds entry within radius', () => {
    const index = new SpatialIndex()
    index.upsert('shp-near', 0, 0)
    // Query 10 km radius around a point 0.05 degrees away (~5.5 km)
    const results = index.findWithinRadius(0, 0.05, 10)
    expect(results).toContain('shp-near')
  })

  it('excludes entry outside radius', () => {
    const index = new SpatialIndex()
    // (10, 10) is about 1,570 km from (0, 0)
    index.upsert('shp-far', 10, 10)
    const results = index.findWithinRadius(0, 0, 5)
    expect(results).toEqual([])
  })

  it('remove deletes entry', () => {
    const index = new SpatialIndex()
    index.upsert('shp-1', 0, 0)
    index.remove('shp-1')
    const results = index.findWithinRadius(0, 0, 10)
    expect(results).toEqual([])
  })

  it('finds multiple entries within radius, excludes those outside', () => {
    const index = new SpatialIndex()
    // Two entries near origin (~1 km apart)
    index.upsert('shp-a', 0, 0)
    index.upsert('shp-b', 0, 0.005)  // ~0.55 km east
    // One entry ~550 km away (5 degrees latitude ≈ 556 km)
    index.upsert('shp-far', 5, 0)

    const results = index.findWithinRadius(0, 0, 100)
    expect(results).toContain('shp-a')
    expect(results).toContain('shp-b')
    // shp-far must not appear
    const hasFar = results.includes('shp-far')
    expect(hasFar).toBeFalsy()
    expect(results.length).toBe(2)
  })
})
