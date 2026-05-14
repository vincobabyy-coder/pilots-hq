import { ObdReader } from '../src/obd'

async function testObdReader() {
  console.log('\n=== OBD Reader Tests ===\n')

  const obd = new ObdReader(true) // Mock mode
  await obd.connect()

  // Test 1: Read all PIDs
  console.log('Test 1: Reading all PIDs...')
  const reading = await obd.readAllPids()
  console.log('OBD Reading:', {
    speed: reading.speed.toFixed(2) + ' km/h',
    rpm: reading.rpm.toFixed(0),
    coolantTemp: reading.coolantTemp.toFixed(1) + '°C',
    fuelLevel: reading.fuelLevel.toFixed(1) + '%',
    errors: reading.errors,
  })

  // Test 2: Verify data ranges
  console.log('\nTest 2: Verifying data ranges...')
  let passed = 0
  let failed = 0

  if (reading.speed >= 0 && reading.speed <= 250) {
    console.log('✓ Speed in valid range')
    passed++
  } else {
    console.log('✗ Speed out of range:', reading.speed)
    failed++
  }

  if (reading.rpm >= 0 && reading.rpm <= 8000) {
    console.log('✓ RPM in valid range')
    passed++
  } else {
    console.log('✗ RPM out of range:', reading.rpm)
    failed++
  }

  if (reading.coolantTemp >= -40 && reading.coolantTemp <= 120) {
    console.log('✓ Coolant temp in valid range')
    passed++
  } else {
    console.log('✗ Coolant temp out of range:', reading.coolantTemp)
    failed++
  }

  if (reading.fuelLevel >= 0 && reading.fuelLevel <= 100) {
    console.log('✓ Fuel level in valid range')
    passed++
  } else {
    console.log('✗ Fuel level out of range:', reading.fuelLevel)
    failed++
  }

  console.log(`\nOBD Tests: ${passed} passed, ${failed} failed`)
  await obd.disconnect()

  return failed === 0
}

export { testObdReader }
