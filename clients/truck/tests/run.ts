import { testObdReader } from './obd.test'
import { testGpsReader } from './gps.test'
import { testAlertDetector } from './alerts.test'

async function runAllTests() {
  console.log('='.repeat(50))
  console.log('PILOTS Truck Client - Test Suite')
  console.log('='.repeat(50))

  const results: { name: string; passed: boolean }[] = []

  try {
    const obdPassed = await testObdReader()
    results.push({ name: 'OBD Reader', passed: obdPassed })
  } catch (err) {
    console.error('OBD Reader tests failed:', err)
    results.push({ name: 'OBD Reader', passed: false })
  }

  try {
    const gpsPassed = await testGpsReader()
    results.push({ name: 'GPS Reader', passed: gpsPassed })
  } catch (err) {
    console.error('GPS Reader tests failed:', err)
    results.push({ name: 'GPS Reader', passed: false })
  }

  try {
    const alertsPassed = testAlertDetector()
    results.push({ name: 'Alert Detector', passed: alertsPassed })
  } catch (err) {
    console.error('Alert Detector tests failed:', err)
    results.push({ name: 'Alert Detector', passed: false })
  }

  // Summary
  console.log('\n' + '='.repeat(50))
  console.log('Test Summary')
  console.log('='.repeat(50))

  for (const result of results) {
    const status = result.passed ? '✓' : '✗'
    console.log(`${status} ${result.name}`)
  }

  const allPassed = results.every((r) => r.passed)
  const passCount = results.filter((r) => r.passed).length

  console.log(`\nTotal: ${passCount}/${results.length} test suites passed`)

  process.exit(allPassed ? 0 : 1)
}

runAllTests().catch(console.error)
