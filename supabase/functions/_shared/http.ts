import { env, timingSafeEqual } from './util.ts'

/** HTTP helpers: CORS, JSON responses, typed errors. */

export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, idempotency-key, mcp-session-id, mcp-protocol-version, x-slotwise-client',
  'Access-Control-Expose-Headers': 'mcp-session-id, x-ratelimit-limit, x-ratelimit-remaining, retry-after, www-authenticate',
  'Access-Control-Max-Age': '86400',
}

export type ErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'invalid_request'
  | 'conflict'
  | 'confirmation_required'
  | 'rate_limited'
  | 'method_not_allowed'
  | 'idempotency_mismatch'
  | 'idempotency_in_progress'
  | 'upstream_error'
  | 'internal'

const STATUS: Record<ErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  invalid_request: 400,
  conflict: 409,
  confirmation_required: 400,
  rate_limited: 429,
  method_not_allowed: 405,
  idempotency_mismatch: 422,
  idempotency_in_progress: 409,
  upstream_error: 502,
  internal: 500,
}

export class ServiceError extends Error {
  constructor(public code: ErrorCode, message: string, public details?: unknown) {
    super(message)
    this.name = 'ServiceError'
  }
  get status() {
    return STATUS[this.code]
  }
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8', ...headers },
  })
}

export function errorResponse(code: ErrorCode, message: string, headers: Record<string, string> = {}, details?: unknown): Response {
  return json({ error: { code, message, ...(details !== undefined ? { details } : {}) } }, STATUS[code], headers)
}

export function fromError(e: unknown, headers: Record<string, string> = {}): Response {
  if (e instanceof ServiceError) return errorResponse(e.code, e.message, headers, e.details)
  console.error(e)
  return errorResponse('internal', 'Internal error', headers)
}

export function preflight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}

export function bearer(req: Request): string | null {
  const h = req.headers.get('authorization') || ''
  const m = /^Bearer\s+(.+)$/i.exec(h.trim())
  return m ? m[1].trim() : null
}

/** Strips '/functions/v1/<name>' and similar prefixes so routing works locally and deployed. */
export function stripPrefix(pathname: string, fnName: string): string {
  let p = pathname.replace(/\/+$/, '') || '/'
  for (const pre of ['/functions/v1', '/' + fnName]) {
    if (p === pre) p = '/'
    else if (p.startsWith(pre + '/')) p = p.slice(pre.length)
  }
  return p
}

/**
 * Internal callers (pg_cron, Database Webhooks, cron -> whatsapp): either
 * `x-slotwise-db-secret: <DB_WEBHOOK_SECRET>` or `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>`.
 */
export function authorizedInternal(req: Request): boolean {
  const secret = env('DB_WEBHOOK_SECRET')
  const given = req.headers.get('x-slotwise-db-secret')
  if (secret && given && timingSafeEqual(given, secret)) return true
  const key = env('SUPABASE_SERVICE_ROLE_KEY')
  const b = bearer(req)
  return !!key && !!b && timingSafeEqual(b, key)
}
