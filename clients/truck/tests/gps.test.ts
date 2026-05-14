import { GpsReader } from '../src/gps'

async function testGpsReader() {
  console.log('\n=== GPS Reader Tests ===\n')

  const gps = new GpsReader(true) // Mock mode
  await gps.connect()

  // Test 1: Read location
  console.log('Test 1: Reading GPS location...')
  const location = await gps.readLocation()
  console.log('GPS Location:', {
    latitude: location.latitude.toFixed(6),
    longitude: location.longitude.toFixed(6),
    accuracy: location.accuracy?.toFixed(2) + 'm',
  })

  // Test 2: Verify coordinates are near Lagos
  console.log('\nTest 2: Verifying mock location (Lagos area)...')
  let passed = 0
  let failed = 0

  const baseLat = 6.5244
  const baseLng = 3.3792
  const variance = 0.01 // ~1km

  if (Math.abs(location.latitude - baseLat) <= variance) {
    console.log('✓ Latitude near Lagos baseline')
    passed++
  } else {
    console.log('✗ Latitude too far from baseline')
    failed++
  }

  if (Math.abs(location.longitude - baseLng) <= variance) {
    console.log('✓ Longitude near Lagos baseline')
    passed++
  } else {
    console.log('✗ Longitude too far from baseline')
    failed++
  }

  // Test 3: Distance calculation
  console.log('\nTest 3: Testing distance calculation...')
  const distance = GpsReader.calculateDistance(
    baseLat,
    baseLng,
    location.latitude,
    location.longitude
  )
  console.log(`Distance from baseline: ${distance.toFixed(3)} km`)

  if (distance < 1) {
    console.log('✓ Distance calculation working')
    passed++
  } else {
    console.log('✗ Distance too large')
    failed++
  }

  console.log(`\nGPS Tests: ${passed} passed, ${failed} failed`)
  await gps.disconnect()

  return failed === 0
}

export { testGpsReader }
