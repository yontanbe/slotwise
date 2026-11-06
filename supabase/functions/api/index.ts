// Slotwise REST API v1. Deploy: supabase functions deploy api --no-verify-jwt (auth is the sw_ API key).
import { serviceRepo } from '../_shared/db.ts'
import { SlidingWindowLimiter } from '../_shared/ratelimit.ts'
import { createService } from '../_shared/service.ts'
import { env } from '../_shared/util.ts'
import { createApiHandler } from './router.ts'

if (import.meta.main) {
  const service = createService({ repo: serviceRepo() })
  const limiter = new SlidingWindowLimiter(Number(env('API_RATE_LIMIT_PER_MIN') ?? 120), 60_000)
  const base = env('SUPABASE_URL')
  Deno.serve(createApiHandler({ service, limiter, serverUrl: base ? `${base}/functions/v1/api/v1` : undefined }))
}
