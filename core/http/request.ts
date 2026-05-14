import { IncomingMessage } from 'http'
import { randomUUID } from 'crypto'
import { PilotsRequest } from './types'

function parseQuery(search: string): Record<string, string> {
  if (!search) return {}
  const params: Record<string, string> = {}
  for (const [k, v] of new URLSearchParams(search)) {
    params[k] = v
  }
  return params
}

export async function buildRequest(raw: IncomingMessage): Promise<PilotsRequest> {
  const rawUrl = raw.url ?? '/'
  const qIndex = rawUrl.indexOf('?')
  const path = qIndex === -1 ? rawUrl : rawUrl.slice(0, qIndex)
  const queryStr = qIndex === -1 ? '' : rawUrl.slice(qIndex + 1)

  // Collect raw bytes and parse JSON body
  let body: unknown = null
  let rawBody: Buffer | undefined
  const contentType = raw.headers['content-type'] ?? ''
  if (contentType.includes('application/json')) {
    const result = await new Promise<{ data: string; buffers: Buffer[] }>((resolve, reject) => {
      let data = ''
      const buffers: Buffer[] = []
      raw.on('data', (chunk: Buffer) => {
        buffers.push(chunk)
        data += chunk.toString()
      })
      raw.on('end', () => {
        resolve({ data, buffers })
      })
      raw.on('error', reject)
    })
    rawBody = Buffer.concat(result.buffers)
    try { body = JSON.parse(result.data || 'null') }
    catch { body = null }
  } else if (raw.headers['content-length']) {
    // For non-JSON requests with a body, still capture rawBody for webhook handlers
    rawBody = await new Promise((resolve, reject) => {
      const buffers: Buffer[] = []
      raw.on('data', (chunk: Buffer) => {
        buffers.push(chunk)
      })
      raw.on('end', () => {
        resolve(Buffer.concat(buffers))
      })
      raw.on('error', reject)
    })
  }

  const headers: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw.headers)) {
    if (typeof v === 'string') headers[k] = v
    else if (Array.isArray(v)) headers[k] = v[0] ?? ''
  }

  return {
    method: raw.method ?? 'GET',
    url: rawUrl,
    path,
    query: parseQuery(queryStr),
    params: {},
    headers,
    body,
    rawBody,
    requestId: randomUUID(),
  }
}
