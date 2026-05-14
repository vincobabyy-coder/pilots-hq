import { AlertDetector } from '../src/alerts'

function testAlertDetector() {
  console.log('\n=== Alert Detector Tests ===\n')

  const detector = new AlertDetector()
  let passed = 0
  let failed = 0

  // Test 1: Hard braking detection
  console.log('Test 1: Hard braking detection...')
  detector.updateState(50, 6.5, 3.4)
  const brakeAlert = detector.checkHardBraking(10, 50) // 50 -> 10 km/h
  if (brakeAlert) {
    console.log('✓ Hard braking detected:', brakeAlert.message)
    passed++
  } else {
    console.log('✗ Hard braking not detected when it should be')
    failed++
  }

  // Test 2: Normal braking should not trigger
  console.log('\nTest 2: Normal braking (should not alert)...')
  // Create a new detector to reset the timing
  const detector2 = new AlertDetector()
  detector2.updateState(50, 6.5, 3.4)
  const normalBrakeAlert = detector2.checkHardBraking(45, 50) // Gentle slowdown
  if (!normalBrakeAlert) {
    console.log('✓ Normal braking correctly ignored')
    passed++
  } else {
    console.log('✗ Normal braking incorrectly triggered alert')
    failed++
  }

  // Test 3: Geofence detection
  console.log('\nTest 3: Geofence violation detection...')
  detector.updateGeofences([
    {
      id: 'zone1',
      name: 'Downtown Lagos',
      latitude: 6.5244,
      longitude: 3.3792,
      radiusKm: 0.5,
      alertOnViolation: true,
    },
  ])

  const geofenceAlert = detector.checkGeofence(
    'TRUCK-001',
    6.45, // Far outside the zone
    3.3
  )
  if (geofenceAlert) {
    console.log('✓ Geofence violation detected:', geofenceAlert.message)
    passed++
  } else {
    console.log('✗ Geofence violation not detected')
    failed++
  }

  // Test 4: Maintenance - low fuel
  console.log('\nTest 4: Low fuel detection...')
  const fuelAlert = detector.checkMaintenance('TRUCK-001', 15, [])
  if (fuelAlert && fuelAlert.type === 'maintenance') {
    console.log('✓ Low fuel alert detected:', fuelAlert.message)
    passed++
  } else {
    console.log('✗ Low fuel alert not detected')
    failed++
  }

  // Test 5: Maintenance - error codes
  console.log('\nTest 5: Engine error code detection...')
  const errorAlert = detector.checkMaintenance('TRUCK-001', 50, ['P0101', 'P0300'])
  if (errorAlert && errorAlert.type === 'maintenance') {
    console.log('✓ Error code alert detected:', errorAlert.message)
    passed++
  } else {
    console.log('✗ Error code alert not detected')
    failed++
  }

  console.log(`\nAlert Tests: ${passed} passed, ${failed} failed`)
  return failed === 0
}

export { testAlertDetector }
