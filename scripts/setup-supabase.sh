#!/usr/bin/env bash
# One-time Supabase setup for Slotwise (run from anywhere inside the repo):
#   cp .env.supabase.example .env.supabase   # fill it in
#   bash scripts/setup-supabase.sh
# Steps: login check, link, db push (supabase/migrations), Edge Function secrets, deploy the 6 functions,
# Vault secret + pg_cron schedule for the cron function, then prints what to paste into Cloudflare.
# Re-running is safe. Uses `supabase` if installed, otherwise `npx -y supabase`.
set -euo pipefail

cd "$(dirname "$0")/.."
ENV_FILE="${ENV_FILE:-.env.supabase}"
FUNCTIONS=(api mcp cron webhooks whatsapp stripe)

if command -v supabase >/dev/null 2>&1; then SB=(supabase); else SB=(npx -y supabase); fi
say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }

[ -f "$ENV_FILE" ] || { echo "Missing $ENV_FILE. Copy .env.supabase.example to $ENV_FILE and fill it in."; exit 1; }
# read KEY=VALUE lines (no `source`, values may contain spaces or < >)
getv() { { grep -E "^$1=" "$ENV_FILE" || true; } | tail -n1 | cut -d= -f2- | sed -E 's/[[:space:]]+#.*$//; s/^[[:space:]]+|[[:space:]]+$//g; s/^"(.*)"$/\1/'; }
REF="${SUPABASE_PROJECT_REF:-$(getv SUPABASE_PROJECT_REF)}"
export SUPABASE_DB_PASSWORD="${SUPABASE_DB_PASSWORD:-$(getv SUPABASE_DB_PASSWORD)}"
SERVICE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-$(getv SUPABASE_SERVICE_ROLE_KEY)}"
[ -n "$REF" ] || { echo "SUPABASE_PROJECT_REF is empty in $ENV_FILE"; exit 1; }
[ -n "$SUPABASE_DB_PASSWORD" ] || { echo "SUPABASE_DB_PASSWORD is empty in $ENV_FILE"; exit 1; }

VERSION="$("${SB[@]}" --version | tr -d '[:space:]')"
MAJOR="${VERSION%%.*}"
# CLI v2 targets the linked project with --linked; v3 with --remote.
if [ "$MAJOR" -le 2 ]; then REMOTE=--linked; else REMOTE=--remote; fi
echo "Supabase CLI $VERSION, project $REF"

say "1. Login (opens a browser once; skipped when SUPABASE_ACCESS_TOKEN is set)"
if [ -z "${SUPABASE_ACCESS_TOKEN:-}" ]; then "${SB[@]}" projects list >/dev/null 2>&1 || "${SB[@]}" login; fi

say "2. Link"
"${SB[@]}" link --project-ref "$REF" --yes

say "3. Database migrations (001_schema.sql, 002_server.sql)"
"${SB[@]}" db push "$REMOTE" -p "$SUPABASE_DB_PASSWORD" --yes

say "4. Edge Function secrets"
TMP="$(mktemp)"; trap 'rm -f "$TMP"' EXIT
grep -E '^[A-Z][A-Z0-9_]*=' "$ENV_FILE" | grep -vE '^SUPABASE_' | while IFS= read -r line; do
  k="${line%%=*}"; v="$(getv "$k")"
  [ -n "$v" ] && printf '%s=%s\n' "$k" "$v"
done > "$TMP" || true
DB_WEBHOOK_SECRET="$(getv DB_WEBHOOK_SECRET)"
if [ -z "$DB_WEBHOOK_SECRET" ]; then
  DB_WEBHOOK_SECRET="$(openssl rand -hex 24)"
  echo "DB_WEBHOOK_SECRET=$DB_WEBHOOK_SECRET" >> "$TMP"
  echo "Generated DB_WEBHOOK_SECRET=$DB_WEBHOOK_SECRET (save it: the Database Webhook header needs it)"
fi
if [ -s "$TMP" ]; then "${SB[@]}" secrets set --env-file "$TMP" --yes; else echo "no secrets to set"; fi

say "5. Deploy Edge Functions"
for f in "${FUNCTIONS[@]}"; do
  "${SB[@]}" functions deploy "$f" --no-verify-jwt --use-api --yes
done

say "6. pg_cron schedule (Vault secret + 002_server.sql with the project ref)"
CRON_SQL=supabase/.cron.local.sql
{
  if [ -n "$SERVICE_KEY" ]; then
    cat <<SQL
do \$\$ begin
  if exists (select 1 from vault.secrets where name = 'slotwise_service_role_key') then
    perform vault.update_secret((select id from vault.secrets where name = 'slotwise_service_role_key'), '$SERVICE_KEY');
  else
    perform vault.create_secret('$SERVICE_KEY', 'slotwise_service_role_key');
  end if;
end \$\$;
SQL
  fi
  sed "s/<PROJECT_REF>/$REF/g" supabase/migrations/002_server.sql
} > "$CRON_SQL"
if [ -z "$SERVICE_KEY" ]; then
  echo "SUPABASE_SERVICE_ROLE_KEY is empty: the cron job will call the function without a valid key."
fi
if [ "$MAJOR" -ge 3 ]; then
  "${SB[@]}" db query "$REMOTE" -f "$CRON_SQL" --yes && rm -f "$CRON_SQL"
else
  echo "Paste $CRON_SQL into Dashboard > SQL Editor and run it (CLI v2 cannot run SQL remotely). Delete the file afterwards: it holds the service role key."
fi

say "Done"
URL="https://$REF.supabase.co"
echo "Supabase URL:      $URL"
echo "Functions:         $URL/functions/v1/<api|mcp|cron|webhooks|whatsapp|stripe>"
echo "Anon (public) key: Dashboard > Project Settings > API Keys > anon / publishable"
"${SB[@]}" projects api-keys --project-ref "$REF" 2>/dev/null | grep -iE 'anon|publishable' || true
cat <<TXT

Put these in the frontend build (they are public, not secrets):
  Cloudflare Pages > slotwise > Settings > Variables and Secrets (Production + Preview):
    VITE_SUPABASE_URL=$URL
    VITE_SUPABASE_ANON_KEY=<anon key above>
  or GitHub > Settings > Secrets and variables > Actions > Variables (for the GitHub Action build).
Then: Authentication > URL Configuration (site URL + redirect URLs, see supabase/config.toml),
Database > Webhooks (records -> webhooks function, header x-slotwise-db-secret), see docs/DEPLOY.md.
TXT
