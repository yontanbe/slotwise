// Slotwise remote MCP server (Streamable HTTP). Deploy: supabase functions deploy mcp --no-verify-jwt
// Connector URL: https://<PROJECT_REF>.supabase.co/functions/v1/mcp  with header Authorization: Bearer sw_...
import { serviceRepo } from '../_shared/db.ts'
import { SlidingWindowLimiter } from '../_shared/ratelimit.ts'
import { createService } from '../_shared/service.ts'
import { env } from '../_shared/util.ts'
import { createMcpHandler } from './server.ts'

if (import.meta.main) {
  // same per key limit as the REST API; every JSON-RPC request in a batch counts once
  const limiter = new SlidingWindowLimiter(Number(env('API_RATE_LIMIT_PER_MIN') ?? 120), 60_000)
  Deno.serve(createMcpHandler({ service: createService({ repo: serviceRepo() }), limiter }))
}
