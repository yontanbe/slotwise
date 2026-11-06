// Scheduler entry point, POSTed every 5 minutes by pg_cron (see supabase/migrations/002_server.sql).
// Deploy: supabase functions deploy cron --no-verify-jwt   (checks the service role key itself)
// Optional ?tasks=workflows,auto_decline,webhook_retry,shabbat,cleanup ; by default the hourly
// tasks (shabbat, cleanup) only run in the first 5 minutes of each UTC hour.
import { serviceRepo } from '../_shared/db.ts'
import { authorizedInternal, errorResponse, json, preflight } from '../_shared/http.ts'
import { ALL_TASKS, type CronTask, runCron } from './run.ts'

if (import.meta.main) {
  Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return preflight()
    if (req.method !== 'POST') return errorResponse('method_not_allowed', 'POST only')
    if (!authorizedInternal(req)) return errorResponse('unauthorized', 'service role key required')
    const param = new URL(req.url).searchParams.get('tasks')
    const hourly = new Date().getUTCMinutes() < 5
    const tasks = param
      ? (param.split(',').filter((t) => (ALL_TASKS as string[]).includes(t)) as CronTask[])
      : ALL_TASKS.filter((t) => hourly || (t !== 'shabbat' && t !== 'cleanup'))
    return json(await runCron({ repo: serviceRepo() }, tasks))
  })
}
