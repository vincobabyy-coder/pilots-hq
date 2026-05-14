/**
 * Artillery processor: hooks into load test lifecycle
 */

module.exports = {
  setup: (context, ee, next) => {
    console.log('[Load Test] Setup phase started')
    next()
  },

  beforeRequest: (requestParams, context, ee, next) => {
    // Add auth headers or custom setup before each request
    next()
  },

  afterResponse: (requestParams, response, context, ee, next) => {
    // Log response metrics
    if (response.statusCode >= 500) {
      console.log(`[Load Test] Server error ${response.statusCode} on ${requestParams.url}`)
    }
    next()
  },

  cleanup: (context, ee, next) => {
    console.log('[Load Test] Cleanup phase completed')
    next()
  },
}
