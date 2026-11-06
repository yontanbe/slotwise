import { describe, expect, it } from 'vitest'
import { bookingVars, dueSteps, renderTemplate, type WfBooking, type WfWorkflow } from '../../supabase/functions/_shared/workflows'

const host = { name: 'Host', email: 'h@x.io', phone: '0521111111', timezone: 'Asia/Jerusalem', locale: 'he' as const }
const b = (over: Partial<WfBooking> = {}): WfBooking => ({
  id: 'b1', token: 'tok', eventTypeId: 'e1', title: 'Intro', start: '2026-12-01T08:00:00.000Z', end: '2026-12-01T08:30:00.000Z',
  status: 'accepted', attendee: { name: 'Dana Levi', email: 'd@x.io', phone: '0541', timezone: 'Asia/Jerusalem', locale: 'he' },
  notes: '', location: { type: 'meet' }, noShow: false, history: [{ at: '2026-11-20T10:00:00.000Z', action: 'created' }], createdAt: '2026-11-20T10:00:00.000Z', ...over,
})
const wf = (over: Partial<WfWorkflow> = {}): WfWorkflow => ({
  id: 'w1', name: 'w', active: true, trigger: 'booked', offsetMins: 0, eventTypeIds: [], createdAt: '2026-11-01T00:00:00.000Z',
  steps: [{ id: 's1', action: 'email_attendee', subject: 'hi {invitee_first_name}', body: 'at {event_time}' }], ...over,
})

describe('workflows', () => {
  it('renders template vars and keeps unknown ones', () => {
    const v = bookingVars(b(), host, 'https://app/')
    expect(renderTemplate('{invitee_first_name} {event_time} {nope}', v)).toBe('Dana 10:00 {nope}')
    expect(v.manage_url).toBe('https://app/#/b/tok')
  })
  it('fires booked once and respects done keys', () => {
    expect(dueSteps(b(), [wf()], '2026-11-20T10:01:00.000Z')).toHaveLength(1)
    expect(dueSteps(b({ workflowDone: ['w1:s1'] }), [wf()], '2026-11-20T10:01:00.000Z')).toHaveLength(0)
  })
  it('does not retro fire for bookings older than the workflow', () => {
    expect(dueSteps(b(), [wf({ createdAt: '2026-11-25T00:00:00.000Z' })], '2026-11-26T00:00:00.000Z')).toHaveLength(0)
  })
  it('filters by event type and inactive', () => {
    expect(dueSteps(b(), [wf({ eventTypeIds: ['other'] })], '2026-11-20T10:01:00.000Z')).toHaveLength(0)
    expect(dueSteps(b(), [wf({ active: false })], '2026-11-20T10:01:00.000Z')).toHaveLength(0)
  })
  it('before_start fires inside the window only', () => {
    const w = wf({ trigger: 'before_start', offsetMins: 60 })
    expect(dueSteps(b(), [w], '2026-12-01T06:59:00.000Z')).toHaveLength(0)
    expect(dueSteps(b(), [w], '2026-12-01T07:01:00.000Z')).toHaveLength(1)
    expect(dueSteps(b(), [w], '2026-12-01T08:01:00.000Z')).toHaveLength(0)
    expect(dueSteps(b({ status: 'cancelled' }), [w], '2026-12-01T07:01:00.000Z')).toHaveLength(0)
  })
  it('after_end skips no shows and very late runs', () => {
    const w = wf({ trigger: 'after_end', offsetMins: 30 })
    expect(dueSteps(b(), [w], '2026-12-01T09:01:00.000Z')).toHaveLength(1)
    expect(dueSteps(b({ noShow: true }), [w], '2026-12-01T09:01:00.000Z')).toHaveLength(0)
    expect(dueSteps(b(), [w], '2026-12-02T09:01:00.000Z')).toHaveLength(0)
  })
  it('cancelled ignores reschedule hops', () => {
    const w = wf({ trigger: 'cancelled' })
    const hist = [{ at: '2026-11-21T00:00:00.000Z', action: 'cancelled' }]
    expect(dueSteps(b({ status: 'cancelled', history: hist }), [w], '2026-11-21T00:01:00.000Z')).toHaveLength(1)
    expect(dueSteps(b({ status: 'cancelled', history: hist, rescheduledToId: 'x' }), [w], '2026-11-21T00:01:00.000Z')).toHaveLength(0)
  })
  it('requested fires for pending bookings', () => {
    expect(dueSteps(b({ status: 'pending' }), [wf({ trigger: 'requested' })], '2026-11-20T10:01:00.000Z')).toHaveLength(1)
    expect(dueSteps(b(), [wf({ trigger: 'requested' })], '2026-11-20T10:01:00.000Z')).toHaveLength(0)
  })
})
