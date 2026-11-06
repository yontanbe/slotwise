/**
 * Data access over the single `records` table. The service role key bypasses RLS,
 * so every owner-scoped call MUST pass `owner`. Everything goes through the Repo
 * interface so the service layer can be tested with a fake.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { RecordKind } from './types.ts'
import { env } from './util.ts'

export interface Rec<T = unknown> {
  id: string
  owner_id: string
  kind: RecordKind
  data: T
  updated_at: string
}

export interface FindQuery {
  owner?: string
  /** equality on json text paths, e.g. { 'data->>status': 'pending' } */
  eq?: Record<string, string>
  in?: Record<string, string[]>
  ilike?: Record<string, string>
  /** jsonb containment, e.g. { 'data->coHostIds': ['uuid'] } */
  contains?: Record<string, unknown>
  updatedAfter?: string
  limit?: number
}

export class DuplicateError extends Error {}

export interface Repo {
  get<T>(kind: RecordKind, id: string, owner?: string): Promise<Rec<T> | null>
  find<T>(kind: RecordKind, q?: FindQuery): Promise<Rec<T>[]>
  insert<T>(kind: RecordKind, owner: string, id: string, data: T): Promise<void>
  /** Compare-and-swap on updated_at. Returns false when someone else wrote first. */
  update<T>(rec: Rec<T>, data: T): Promise<boolean>
  remove(id: string): Promise<void>
  rpc<T>(fn: string, args: Record<string, unknown>): Promise<T>
}

/** Read-modify-write with optimistic concurrency. `fn` returns null to abort. */
export async function mutate<T>(
  repo: Repo,
  kind: RecordKind,
  id: string,
  owner: string | undefined,
  fn: (data: T) => T | null,
  retries = 4,
): Promise<T | null> {
  for (let i = 0; i < retries; i++) {
    const rec = await repo.get<T>(kind, id, owner)
    if (!rec) return null
    const next = fn(structuredClone(rec.data))
    if (next === null) return null
    if (await repo.update(rec, next)) return next
  }
  throw new Error(`mutate: too much contention on ${kind}/${id}`)
}

const PAGE = 1000
const MAX_ROWS = 20000

export class SupabaseRepo implements Repo {
  constructor(private sb: SupabaseClient) {}

  async get<T>(kind: RecordKind, id: string, owner?: string): Promise<Rec<T> | null> {
    let q = this.sb.from('records').select('*').eq('kind', kind).eq('id', id)
    if (owner) q = q.eq('owner_id', owner)
    const { data, error } = await q.maybeSingle()
    if (error) throw new Error(`db get: ${error.message}`)
    return (data as Rec<T>) ?? null
  }

  async find<T>(kind: RecordKind, fq: FindQuery = {}): Promise<Rec<T>[]> {
    const out: Rec<T>[] = []
    const limit = Math.min(fq.limit ?? MAX_ROWS, MAX_ROWS)
    for (let from = 0; from < limit; from += PAGE) {
      let q = this.sb.from('records').select('*').eq('kind', kind)
      if (fq.owner) q = q.eq('owner_id', fq.owner)
      for (const [k, v] of Object.entries(fq.eq ?? {})) q = q.eq(k, v)
      for (const [k, v] of Object.entries(fq.in ?? {})) q = q.in(k, v)
      for (const [k, v] of Object.entries(fq.ilike ?? {})) q = q.ilike(k, v)
      for (const [k, v] of Object.entries(fq.contains ?? {})) q = q.contains(k, v as string[])
      if (fq.updatedAfter) q = q.gte('updated_at', fq.updatedAfter)
      const { data, error } = await q.order('id').range(from, Math.min(from + PAGE, limit) - 1)
      if (error) throw new Error(`db find: ${error.message}`)
      out.push(...((data ?? []) as Rec<T>[]))
      if (!data || data.length < PAGE) break
    }
    return out
  }

  async insert<T>(kind: RecordKind, owner: string, id: string, data: T): Promise<void> {
    const { error } = await this.sb.from('records').insert({ id, owner_id: owner, kind, data })
    if (error) {
      if (error.code === '23505') throw new DuplicateError(id)
      throw new Error(`db insert: ${error.message}`)
    }
  }

  async update<T>(rec: Rec<T>, data: T): Promise<boolean> {
    const { data: rows, error } = await this.sb
      .from('records')
      .update({ data, updated_at: new Date().toISOString() })
      .eq('id', rec.id)
      .eq('updated_at', rec.updated_at)
      .select('id')
    if (error) throw new Error(`db update: ${error.message}`)
    return (rows ?? []).length === 1
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.sb.from('records').delete().eq('id', id)
    if (error) throw new Error(`db delete: ${error.message}`)
  }

  async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await this.sb.rpc(fn, args)
    if (error) throw new Error(`db rpc ${fn}: ${error.message}`)
    return data as T
  }
}

/** Service role client from env. Never call at module top level (keeps tests offline). */
export function serviceClient(): SupabaseClient {
  const url = env('SUPABASE_URL')
  const key = env('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

export function serviceRepo(): Repo {
  return new SupabaseRepo(serviceClient())
}
