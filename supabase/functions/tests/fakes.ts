/** In-memory test doubles: no network, no database. */
import { DuplicateError, type FindQuery, type Rec, type Repo } from '../_shared/db.ts'
import type { RecordKind } from '../_shared/types.ts'
import type { AuthInfo, SlotwiseService } from '../_shared/service.ts'

function readPath(data: unknown, path: string): unknown {
  // supports 'data->>x', 'data->a->>b', 'data->x'
  const parts = path.replace(/^data/, '').split(/->>?/).filter(Boolean)
  let cur: unknown = data
  for (const p of parts) cur = cur && typeof cur === 'object' ? (cur as Record<string, unknown>)[p] : undefined
  return cur
}

export class MemoryRepo implements Repo {
  rows = new Map<string, Rec<unknown>>()
  rpcs: Record<string, (args: Record<string, unknown>) => unknown> = {}
  private clock = 0

  seed<T>(kind: RecordKind, owner: string, id: string, data: T) {
    this.rows.set(id, { id, owner_id: owner, kind, data: structuredClone(data), updated_at: this.tick() })
  }
  private tick() {
    return new Date(Date.UTC(2026, 0, 1) + ++this.clock).toISOString()
  }
  all<T>(kind: RecordKind): Rec<T>[] {
    return [...this.rows.values()].filter((r) => r.kind === kind) as Rec<T>[]
  }

  get<T>(kind: RecordKind, id: string, owner?: string): Promise<Rec<T> | null> {
    const r = this.rows.get(id)
    if (!r || r.kind !== kind || (owner && r.owner_id !== owner)) return Promise.resolve(null)
    return Promise.resolve(structuredClone(r) as Rec<T>)
  }
  find<T>(kind: RecordKind, q: FindQuery = {}): Promise<Rec<T>[]> {
    let out = this.all<T>(kind).filter((r) => !q.owner || r.owner_id === q.owner)
    for (const [k, v] of Object.entries(q.eq ?? {})) out = out.filter((r) => String(readPath(r.data, k)) === v)
    for (const [k, v] of Object.entries(q.in ?? {})) out = out.filter((r) => v.includes(String(readPath(r.data, k))))
    for (const [k, v] of Object.entries(q.ilike ?? {})) {
      const re = new RegExp('^' + v.split('%').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', 'i')
      out = out.filter((r) => re.test(String(readPath(r.data, k) ?? '')))
    }
    for (const [k, v] of Object.entries(q.contains ?? {})) {
      out = out.filter((r) => {
        const arr = readPath(r.data, k)
        return Array.isArray(arr) && (v as unknown[]).every((x) => arr.includes(x))
      })
    }
    return Promise.resolve(out.slice(0, q.limit ?? Infinity).map((r) => structuredClone(r)))
  }
  insert<T>(kind: RecordKind, owner: string, id: string, data: T): Promise<void> {
    if (this.rows.has(id)) return Promise.reject(new DuplicateError(id))
    this.seed(kind, owner, id, data)
    return Promise.resolve()
  }
  update<T>(rec: Rec<T>, data: T): Promise<boolean> {
    const cur = this.rows.get(rec.id)
    if (!cur || cur.updated_at !== rec.updated_at) return Promise.resolve(false)
    this.rows.set(rec.id, { ...cur, data: structuredClone(data), updated_at: this.tick() })
    return Promise.resolve(true)
  }
  remove(id: string): Promise<void> {
    this.rows.delete(id)
    return Promise.resolve()
  }
  rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    const f = this.rpcs[fn]
    if (!f) return Promise.reject(new Error(`rpc ${fn} not faked`))
    return Promise.resolve(f(args) as T)
  }
}

export const AUTH: AuthInfo = { ownerId: '00000000-0000-0000-0000-000000000001', apiKeyId: 'key1', keyName: 'test', scopes: ['read', 'write'] }
export const GOOD_KEY = 'sw_test_good_key_123456'

export interface Call {
  method: string
  args: unknown[]
}

/** Fake service that records calls. Methods return simple canned data. */
export function fakeService(overrides: Partial<SlotwiseService> = {}): SlotwiseService & { calls: Call[] } {
  const calls: Call[] = []
  const rec =
    <T>(method: string, value: T) =>
    (...args: unknown[]) => {
      calls.push({ method, args })
      return Promise.resolve(value)
    }
  const booking = { id: 'b1', token: 't'.repeat(24), status: 'accepted', start: '2030-01-01T09:00:00.000Z', end: '2030-01-01T09:30:00.000Z' }
  const svc = {
    calls,
    authenticate: (k: string | null) => Promise.resolve(k === GOOD_KEY ? AUTH : null),
    me: rec('me', { id: AUTH.ownerId, name: 'Host' }),
    listEventTypes: rec('listEventTypes', [{ id: 'et1', title: 'Intro', durations: [30] }]),
    getEventType: rec('getEventType', { id: 'et1', title: 'Intro' }),
    getAvailability: rec('getAvailability', { eventTypeId: 'et1', duration: 30, timezone: 'UTC', from: '', to: '', slots: [], days: [] }),
    listBookings: rec('listBookings', { bookings: [booking], total: 1, limit: 50, offset: 0 }),
    getBooking: rec('getBooking', booking),
    createBooking: rec('createBooking', { booking, replayed: false }),
    cancelBooking: rec('cancelBooking', { ...booking, status: 'cancelled' }),
    rescheduleBooking: rec('rescheduleBooking', booking),
    createLink: rec('createLink', { link: { id: 'l1' }, url: 'http://x/#/d/abc' }),
    createPoll: rec('createPoll', { poll: { id: 'p1' }, url: 'http://x/#/p/p1' }),
    updateAvailability: rec('updateAvailability', { schedule: { id: 's1' }, changedDates: ['2030-01-01'] }),
    getInsights: rec('getInsights', { total: 0 }),
    sendReminder: rec('sendReminder', { status: 'logged', provider: 'none', outboxId: 'o1' }),
  }
  // deno-lint-ignore no-explicit-any
  return Object.assign(svc as any, overrides)
}
