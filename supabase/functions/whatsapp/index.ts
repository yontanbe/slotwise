// WhatsApp Cloud API webhook + internal send. Deploy: supabase functions deploy whatsapp --no-verify-jwt
// Meta callback URL: https://<PROJECT_REF>.supabase.co/functions/v1/whatsapp
import { serviceRepo, type Repo } from '../_shared/db.ts'
import { createWhatsAppHandler } from './handler.ts'

if (import.meta.main) {
  let repo: Repo | null = null
  Deno.serve(createWhatsAppHandler({ repo: () => (repo ??= serviceRepo()) }))
}
