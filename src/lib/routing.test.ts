import { describe, expect, it } from 'vitest'
import { routeFor } from './routing'

const form = {
  fallback: { type: 'message' as const, text: 'fallback' },
  rules: [
    { id: '1', match: 'all' as const, conditions: [{ fieldId: 'size', op: 'gt' as const, value: '50' }, { fieldId: 'need', op: 'equals' as const, value: 'Sales' }], target: { type: 'event' as const, eventTypeId: 'enterprise' } },
    { id: '2', match: 'any' as const, conditions: [{ fieldId: 'need', op: 'equals' as const, value: 'sales' }, { fieldId: 'note', op: 'contains' as const, value: 'price' }], target: { type: 'event' as const, eventTypeId: 'smb' } },
    { id: '3', match: 'all' as const, conditions: [{ fieldId: 'tags', op: 'equals' as const, value: 'vip' }], target: { type: 'url' as const, url: 'https://x' } },
  ],
}

describe('routing', () => {
  it('first matching rule wins', () => {
    expect(routeFor(form, { size: '120', need: 'sales' })).toEqual({ type: 'event', eventTypeId: 'enterprise' })
    expect(routeFor(form, { size: '10', need: 'Sales' })).toEqual({ type: 'event', eventTypeId: 'smb' })
  })
  it('any / contains / multi select / fallback', () => {
    expect(routeFor(form, { note: 'what is the PRICE?' })).toEqual({ type: 'event', eventTypeId: 'smb' })
    expect(routeFor(form, { tags: ['a', 'VIP'] })).toEqual({ type: 'url', url: 'https://x' })
    expect(routeFor(form, {})).toEqual({ type: 'message', text: 'fallback' })
  })
})
