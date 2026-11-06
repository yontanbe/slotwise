// Stripe Checkout + webhook. Deploy: supabase functions deploy stripe --no-verify-jwt
// Stripe webhook endpoint: https://<PROJECT_REF>.supabase.co/functions/v1/stripe/webhook
import { serviceRepo, type Repo } from '../_shared/db.ts'
import { createStripeHandler } from './handler.ts'

if (import.meta.main) {
  let repo: Repo | null = null
  Deno.serve(createStripeHandler({ repo: () => (repo ??= serviceRepo()) }))
}
