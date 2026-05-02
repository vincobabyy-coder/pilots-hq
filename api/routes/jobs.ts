import { Router } from '../../core/http/router'
import { getDlqJobs, replayDlqJob, getJobTrace } from '../../core/queue/queue'
import { logger } from '../../core/logger/logger'

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export function jobsRouter(): Router {
  const router = new Router()

  // GET /api/v1/jobs/:queueName/dlq — list DLQ jobs (max 20)
  router.get('/:queueName/dlq', async (req, res) => {
    const { queueName } = req.params
    if (!queueName || typeof queueName !== 'string') {
      res.status(400).fail('VALIDATION_ERROR', 'queueName is required', 400); return
    }

    try {
      const jobs = await getDlqJobs(queueName, 20)
      res.ok({ jobs, meta: { count: jobs.length, queue: queueName } })
    } catch (err) {
      logger.error('Handler error', { error: (err as Error).message, path: req.path, method: req.method })
      res.status(500).fail('INTERNAL_ERROR', 'Internal server error', 500)
    }
  })

  // POST /api/v1/jobs/:queueName/dlq/:jobId/replay — replay a DLQ job
  router.post('/:queueName/dlq/:jobId/replay', async (req, res) => {
    const { queueName, jobId } = req.params
    if (!queueName || typeof queueName !== 'string') {
      res.status(400).fail('VALIDATION_ERROR', 'queueName is required', 400); return
    }
    if (!jobId || typeof jobId !== 'string') {
      res.status(400).fail('VALIDATION_ERROR', 'jobId is required', 400); return
    }

    // Require authentication — orgId is populated by the JWT middleware
    if (!req.orgId) {
      res.status(401).fail('UNAUTHORIZED', 'Authentication required', 401); return
    }

    try {
      const newJobId = await replayDlqJob(jobId, queueName)
      res.ok({ originalJobId: jobId, newJobId, queue: queueName })
    } catch (err) {
      const message = (err as Error).message ?? ''
      if (message.includes('not found')) {
        res.status(404).fail('JOB_NOT_FOUND', `Job "${jobId}" not found in store`, 404); return
      }
      logger.error('Handler error', { error: (err as Error).message, path: req.path, method: req.method })
      res.status(500).fail('INTERNAL_ERROR', 'Internal server error', 500)
    }
  })

  // GET /api/v1/jobs/:jobId/trace — get execution trace for any job
  router.get('/:jobId/trace', async (req, res) => {
    const { jobId } = req.params
    if (!jobId || typeof jobId !== 'string') {
      res.status(400).fail('VALIDATION_ERROR', 'jobId is required', 400); return
    }

    // Require authentication — orgId is populated by the JWT middleware
    if (!req.orgId) {
      res.status(401).fail('UNAUTHORIZED', 'Authentication required', 401); return
    }

    try {
      const trace = await getJobTrace(jobId)
      res.ok({ jobId, trace })
    } catch (err) {
      logger.error('Handler error', { error: (err as Error).message, path: req.path, method: req.method })
      res.status(500).fail('INTERNAL_ERROR', 'Internal server error', 500)
    }
  })

  return router
}
