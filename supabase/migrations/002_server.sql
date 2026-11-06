-- Slotwise 002: server-only additions for the Edge Functions (api, mcp, cron, webhooks, whatsapp, stripe).
-- Run after supabase/schema.sql. Additive only: creates indexes, extensions and a cron job.
-- Nothing defined in schema.sql is altered or dropped. Safe to re-run.

-- ---------- indexes ----------

-- owner + kind + status lookups (bookings by status, webhook deliveries to retry)
create index if not exists records_owner_kind_status
  on public.records (owner_id, kind, (data ->> 'status'));

-- cross-owner scans by cron: pending bookings (auto decline) and retrying deliveries
create index if not exists records_kind_status
  on public.records (kind, (data ->> 'status'))
  where kind in ('booking', 'webhook_delivery');

-- API key lookup by sha-256 hash (Authorization: Bearer sw_...)
create unique index if not exists records_api_key_hash
  on public.records ((data ->> 'hash'))
  where kind = 'api_key';

-- idempotency: the record id is the key (primary key enforces uniqueness);
-- this index serves the hourly cleanup of entries older than 24h
create index if not exists records_idempotency_created
  on public.records ((data ->> 'createdAt'))
  where kind = 'idempotency';

-- collective bookings where the caller is a co-host (data.coHostIds @> '["<uuid>"]')
create index if not exists records_booking_cohosts
  on public.records using gin ((data -> 'coHostIds') jsonb_path_ops)
  where kind = 'booking';

-- audit log browsing per owner, newest first
create index if not exists records_audit_at
  on public.records (owner_id, (data ->> 'at') desc)
  where kind = 'audit';

-- ---------- scheduler: pg_cron + pg_net -> functions/v1/cron every 5 minutes ----------
--
-- 1. Store the service role key in Vault once (SQL editor, NOT in this file):
--      select vault.create_secret('<SERVICE_ROLE_KEY>', 'slotwise_service_role_key');
-- 2. Replace <PROJECT_REF> below with your project ref (Settings > General) and run this file.
--    While the placeholder is still there the job is not scheduled (a NOTICE is raised instead).
-- 3. Inspect runs: select * from cron.job_run_details order by start_time desc limit 20;
--    Inspect HTTP results: select * from net._http_response order by created desc limit 20;
-- To remove: select cron.unschedule('slotwise-cron');

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $do$
declare
  v_url text := 'https://<PROJECT_REF>.supabase.co/functions/v1/cron';
begin
  if v_url ~ '[<>]' then  -- placeholder not replaced yet
    raise notice 'slotwise-cron not scheduled: replace <PROJECT_REF> in 002_server.sql and run it again';
    return;
  end if;
  perform cron.schedule(
    'slotwise-cron',
    '*/5 * * * *',
    format($job$
      select net.http_post(
        url := %L,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'slotwise_service_role_key' limit 1)
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 55000
      );
    $job$, v_url)
  );
end
$do$;

-- ---------- outgoing webhooks: Database Webhook ----------
-- Preferred setup is the dashboard (Database > Webhooks), see docs/SERVER.md:
--   table public.records, events INSERT + UPDATE, type Supabase Edge Function "webhooks",
--   header x-slotwise-db-secret: <DB_WEBHOOK_SECRET>.
-- The dashboard webhook fires for every row of records; the function ignores kinds other than
-- booking / poll / routing_form. If that volume matters, use this filtered trigger instead
-- (same payload shape). Uncomment, replace the placeholders, and do not also create the dashboard webhook.
--
-- create or replace function public._server_notify_webhooks() returns trigger
-- language plpgsql security definer set search_path = public as $$
-- begin
--   perform net.http_post(
--     url := 'https://<PROJECT_REF>.supabase.co/functions/v1/webhooks',
--     headers := jsonb_build_object('Content-Type', 'application/json',
--       'x-slotwise-db-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'slotwise_db_webhook_secret' limit 1)),
--     body := jsonb_build_object('type', tg_op, 'table', tg_table_name, 'schema', tg_table_schema,
--       'record', to_jsonb(new), 'old_record', case when tg_op = 'UPDATE' then to_jsonb(old) end),
--     timeout_milliseconds := 10000);
--   return new;
-- end $$;
-- revoke all on function public._server_notify_webhooks() from public, anon, authenticated;
-- create trigger server_notify_webhooks after insert or update on public.records
--   for each row when (new.kind in ('booking', 'poll', 'routing_form'))
--   execute function public._server_notify_webhooks();
