import { describe, expect, it } from 'vitest'
import type { Booking } from '../lib/types'
import { neededNotice, pendingWebhookEvents, subtractIntervals } from './sync'

const b = (o: Partial<Booking> = {}) => ({ status: 'accepted', history: [], emailsSent: [], ...o }) as unknown as Booking

describe('sync helpers', () => {
  it('subtracts own bookings from merged busy blocks', () => {
    const busy = [{ start: '2030-01-01T08:00:00.000Z', end: '2030-01-01T10:00:00.000Z' }]
    const own = [{ start: '2030-01-01T08:00:00.000Z', end: '2030-01-01T08:30:00.000Z' }]
    expect(subtractIntervals(busy, own)).toEqual([{ start: '2030-01-01T08:30:00.000Z', end: '2030-01-01T10:00:00.000Z' }])
    expect(subtractIntervals(busy, [{ start: '2030-01-01T07:00:00.000Z', end: '2030-01-01T11:00:00.000Z' }])).toEqual([])
    expect(subtractIntervals(busy, [{ start: '2030-01-01T09:00:00.000Z', end: '2030-01-01T09:15:00.000Z' }])).toHaveLength(2)
  })
  it('notice state machine', () => {
    expect(neededNotice(b())).toBe('booked')
    expect(neededNotice(b({ emailsSent: ['booked'] }))).toBe(null)
    expect(neededNotice(b({ status: 'pending' }))).toBe('requested')
    expect(neededNotice(b({ emailsSent: ['requested'] }))).toBe('confirmed')
    expect(neededNotice(b({ status: 'cancelled', emailsSent: ['booked'] }))).toBe('cancelled')
    expect(neededNotice(b({ status: 'cancelled', emailsSent: ['booked'], rescheduledToId: 'x' }))).toBe(null)
    expect(neededNotice(b({ rescheduledFromId: 'x' }))).toBe('rescheduled')
  })
  it('webhook events derived from state', () => {
    expect(pendingWebhookEvents(b())).toEqual(['booking.created'])
    expect(pendingWebhookEvents(b({ webhooksSent: ['booking.created'], status: 'cancelled' }))).toEqual(['booking.cancelled'])
    expect(pendingWebhookEvents(b({ rescheduledFromId: 'x' }))).toEqual(['booking.rescheduled'])
  })
})
