import { randomUUID } from 'crypto'

export type ErrorSeverity = 'info' | 'warning' | 'error' | 'critical'

export interface FieldError {
  name: string          // field name, e.g. "email"
  value: unknown        // the actual bad value they sent
  constraint: string    // what was violated, e.g. "RFC 5321 email format"
  suggestedFix: string  // e.g. "Use format user@example.com"
}

export interface SuggestedAction {
  action: string
  endpoint?: string
  payload?: object
  likelihood: 'primary' | 'secondary' | 'tertiary'
}

export interface ActionableError {
  code: string
  severity: ErrorSeverity
  httpStatus: number
  userMessage: string
  technicalMessage: string
  fields?: FieldError[]
  suggestedActions?: SuggestedAction[]
  telemetryId: string
  docsPath?: string
}

export function buildError(
  code: string,
  httpStatus: number,
  userMessage: string,
  opts?: {
    severity?: ErrorSeverity
    technicalMessage?: string
    fields?: FieldError[]
    suggestedActions?: SuggestedAction[]
    docsPath?: string
  }
): ActionableError {
  const err: ActionableError = {
    code,
    severity: opts?.severity ?? 'error',
    httpStatus,
    userMessage,
    technicalMessage: opts?.technicalMessage ?? userMessage,
    telemetryId: randomUUID(),
    ...(opts?.fields !== undefined && { fields: opts.fields }),
    ...(opts?.suggestedActions !== undefined && { suggestedActions: opts.suggestedActions }),
    ...(opts?.docsPath !== undefined && { docsPath: opts.docsPath }),
  }
  return Object.freeze(err)
}

export const Errors = {
  validation(fields: FieldError[]): ActionableError {
    const fieldList = fields.map(f => f.name).join(', ')
    return buildError(
      'VALIDATION_ERROR',
      400,
      `The request contains invalid data. Please correct the following fields: ${fieldList}.`,
      {
        severity: 'warning',
        technicalMessage: `Input validation failed on fields: ${fieldList}`,
        fields,
        suggestedActions: [
          {
            action: 'Review the fields array in this response and correct each listed value, then resubmit the request.',
            likelihood: 'primary',
          },
        ],
        docsPath: '/docs/errors/VALIDATION_ERROR',
      }
    )
  },

  notFound(resource: string, id: string): ActionableError {
    return buildError(
      'NOT_FOUND',
      404,
      `${resource} with id "${id}" was not found.`,
      {
        severity: 'warning',
        technicalMessage: `Resource "${resource}" lookup returned no rows for id="${id}"`,
        suggestedActions: [
          {
            action: `Verify the ${resource} id is correct and belongs to this organisation.`,
            likelihood: 'primary',
          },
          {
            action: `List available ${resource} records to find the correct id.`,
            likelihood: 'secondary',
          },
        ],
        docsPath: '/docs/errors/NOT_FOUND',
      }
    )
  },

  unauthorized(reason?: string): ActionableError {
    return buildError(
      'UNAUTHORIZED',
      401,
      'Authentication is required to access this resource.',
      {
        severity: 'warning',
        technicalMessage: reason ?? 'Request arrived without a valid bearer token or session.',
        suggestedActions: [
          {
            action: 'Obtain a valid access token via POST /api/v1/auth/token and include it as a Bearer token in the Authorization header.',
            endpoint: 'POST /api/v1/auth/token',
            likelihood: 'primary',
          },
        ],
        docsPath: '/docs/errors/UNAUTHORIZED',
      }
    )
  },

  forbidden(resource: string, action: string): ActionableError {
    return buildError(
      'FORBIDDEN',
      403,
      `You do not have permission to ${action} this ${resource}.`,
      {
        severity: 'warning',
        technicalMessage: `Role-based access check failed: action="${action}" on resource="${resource}"`,
        suggestedActions: [
          {
            action: 'Contact your organisation administrator to request the appropriate role or permission.',
            likelihood: 'primary',
          },
        ],
        docsPath: '/docs/errors/FORBIDDEN',
      }
    )
  },

  internalError(technicalDetail?: string): ActionableError {
    return buildError(
      'INTERNAL_ERROR',
      500,
      'An unexpected error occurred. Our team has been notified. Please try again shortly.',
      {
        severity: 'critical',
        technicalMessage: technicalDetail ?? 'Unhandled exception in request handler',
        suggestedActions: [
          {
            action: 'Retry the request after a short delay. If the error persists, contact PILOTS support with the telemetryId.',
            likelihood: 'primary',
          },
        ],
        docsPath: '/docs/errors/INTERNAL_ERROR',
      }
    )
  },

  rateLimited(retryAfterSeconds: number): ActionableError {
    return buildError(
      'RATE_LIMITED',
      429,
      `You have exceeded the allowed request rate. Please wait ${retryAfterSeconds} seconds before retrying.`,
      {
        severity: 'warning',
        technicalMessage: `Rate limit exceeded. Client must back off for ${retryAfterSeconds}s.`,
        suggestedActions: [
          {
            action: `Wait ${retryAfterSeconds} seconds then retry the request. Consider implementing exponential back-off in your client.`,
            likelihood: 'primary',
          },
        ],
        docsPath: '/docs/errors/RATE_LIMITED',
      }
    )
  },

  allocationFailed(warehouseId: string, reason: string): ActionableError {
    return buildError(
      'ALLOCATION_FAILED',
      422,
      'The order could not be allocated to a warehouse. Please review the allocation constraints and try again.',
      {
        severity: 'error',
        technicalMessage: `Allocation failed for warehouseId="${warehouseId}": ${reason}`,
        suggestedActions: [
          {
            action: 'Trigger re-allocation for this order once the underlying constraint has been resolved.',
            endpoint: 'POST /api/v1/orders/:id/allocate',
            payload: { force: true },
            likelihood: 'primary',
          },
          {
            action: 'Check the warehouse capacity and inventory levels before retrying.',
            endpoint: 'GET /api/v1/warehouses/:id/capacity',
            likelihood: 'secondary',
          },
        ],
        docsPath: '/docs/errors/ALLOCATION_FAILED',
      }
    )
  },

  warehouseOverCapacity(warehouseId: string, currentUtilization: number): ActionableError {
    const pct = (currentUtilization * 100).toFixed(1)
    return buildError(
      'WAREHOUSE_OVER_CAPACITY',
      422,
      `Warehouse is at ${pct}% capacity and cannot accept additional stock. Reallocate existing orders or wait for inventory to clear.`,
      {
        severity: 'error',
        technicalMessage: `Warehouse warehouseId="${warehouseId}" at ${pct}% utilization — over accepted threshold.`,
        suggestedActions: [
          {
            action: 'Re-allocate other orders currently assigned to this warehouse to reduce utilization.',
            endpoint: 'POST /api/v1/orders/:id/allocate',
            payload: { excludeWarehouseId: warehouseId },
            likelihood: 'primary',
          },
          {
            action: 'Check the warehouse inventory API to identify large stock items that can be moved or cleared.',
            endpoint: 'GET /api/v1/warehouses/:id/inventory',
            likelihood: 'secondary',
          },
        ],
        docsPath: '/docs/errors/WAREHOUSE_OVER_CAPACITY',
      }
    )
  },

  routeInfeasible(constraintViolation: string): ActionableError {
    return buildError(
      'ROUTE_INFEASIBLE',
      422,
      'No feasible route could be computed for this delivery. Check the destination and vehicle constraints.',
      {
        severity: 'error',
        technicalMessage: `Route solver returned infeasible: ${constraintViolation}`,
        suggestedActions: [
          {
            action: 'Review destination coordinates and ensure they are within the supported delivery zone.',
            likelihood: 'primary',
          },
          {
            action: 'Adjust vehicle capacity or time-window constraints and retry route planning.',
            likelihood: 'secondary',
          },
        ],
        docsPath: '/docs/errors/ROUTE_INFEASIBLE',
      }
    )
  },
} as const
