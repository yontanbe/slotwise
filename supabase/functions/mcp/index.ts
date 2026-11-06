// Slotwise remote MCP server (Streamable HTTP). Deploy: supabase functions deploy mcp --no-verify-jwt
// Connector URL: https://<PROJECT_REF>.supabase.co/functions/v1/mcp  with header Authorization: Bearer sw_...
import { serviceRepo } from '../_shared/db.ts'
import { createService } from '../_shared/service.ts'
import { createMcpHandler } from './server.ts'

if (import.meta.main) {
  Deno.serve(createMcpHandler({ service: createService({ repo: serviceRepo() }) }))
}
