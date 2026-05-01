import { ActionableError } from './errors'

export interface PilotsRequest {
  method: string
  url: string
  path: string
  query: Record<string, string>
  params: Record<string, string>
  headers: Record<string, string>
  body: unknown
  requestId: string
  userId?: string
  orgId?: string
  userRole?: string
}

export interface PilotsResponse {
  /** The HTTP status code that will be / was sent. Defaults to 200. */
  statusCode: number
  status(code: number): PilotsResponse
  setHeader(name: string, value: string): PilotsResponse
  json(data: unknown): void
  ok(data: unknown, meta?: Record<string, unknown>): void
  fail(code: string, message: string, httpStatus?: number, fields?: Array<{field: string; message: string}>): void
  /** Formats and sends an ActionableError. Does not replace .fail() — existing routes are unaffected. */
  respondError(error: ActionableError): void
  end(): void
}

export type Handler = (req: PilotsRequest, res: PilotsResponse) => Promise<void> | void
export type Middleware = (req: PilotsRequest, res: PilotsResponse, next: () => Promise<void>) => Promise<void> | void
