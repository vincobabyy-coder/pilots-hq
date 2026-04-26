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

  // Parse JSON body
  let body: unknown = null
  const contentType = raw.headers['content-type'] ?? ''
  if (contentType.includes('application/json')) {
    body = await new Promise((resolve, reject) => {
      let data = ''
      raw.on('data', chunk => { data += chunk })
      raw.on('end', () => {
        try { resolve(JSON.parse(data || 'null')) }
        catch { resolve(null) }
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
    requestId: randomUUID(),
  }
}
