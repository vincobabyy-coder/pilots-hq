import { scheduler } from './scheduler'
import { rotateEncryptionKeys } from './key-rotation'
import { optimizeRoutes } from './route-optimization'
import { processSmsQueue } from './sms-processor'

export function initializeJobs(): void {
  // Register all scheduled jobs
  scheduler.register({
    id: 'key-rotation',
    name: 'JWT Encryption Key Rotation',
    schedule: 'monthly',
    handler: rotateEncryptionKeys,
    maxDurationMs: 30_000,
    retryOnFailure: true,
  })

  scheduler.register({
    id: 'route-optimization',
    name: 'Route Optimization',
    schedule: 'daily',
    handler: optimizeRoutes,
    maxDurationMs: 300_000, // 5 minutes
    retryOnFailure: true,
  })

  scheduler.register({
    id: 'sms-processor',
    name: 'SMS Queue Processor',
    schedule: 'every 5 minutes',
    handler: processSmsQueue,
    maxDurationMs: 60_000, // 1 minute
    retryOnFailure: false,
  })
}

export async function startJobs(): Promise<void> {
  initializeJobs()
  await scheduler.start()
}

export function stopJobs(): void {
  scheduler.stop()
}
