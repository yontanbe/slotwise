import { describe, expect, it } from 'vitest'
import { DateTime } from 'luxon'
import { shabbatBlocks } from './holidays'

const s = { enabled: true, city: 'Jerusalem', blockHolidays: true, showHebrewDate: true }

describe('shabbatBlocks', () => {
  it('blocks Friday candle lighting to Saturday havdalah', () => {
    const b = shabbatBlocks(s, '2026-11-05T00:00:00Z', '2026-11-09T00:00:00Z')
    expect(b).toHaveLength(1)
    const st = DateTime.fromISO(b[0].start).setZone('Asia/Jerusalem')
    const en = DateTime.fromISO(b[0].end).setZone('Asia/Jerusalem')
    expect(st.weekday).toBe(5)
    expect(en.weekday).toBe(6)
    expect(st.hour).toBeGreaterThanOrEqual(15)
    expect(en.hour).toBeGreaterThanOrEqual(16)
  })
  it('covers Rosh Hashana 2026 as one span with the holidays flag', () => {
    const b = shabbatBlocks(s, '2026-09-10T00:00:00Z', '2026-09-14T00:00:00Z')
    expect(b).toHaveLength(1)
    expect(b[0].start.slice(0, 10)).toBe('2026-09-11')
    expect(b[0].end.slice(0, 10)).toBe('2026-09-13')
  })
  it('returns nothing when disabled', () => {
    expect(shabbatBlocks({ ...s, enabled: false, blockHolidays: false }, '2026-11-05T00:00:00Z', '2026-11-09T00:00:00Z')).toHaveLength(0)
  })
  it('skips a weekday Yom Tov when only Shabbat is blocked', () => {
    // Yom Kippur 2026 is Monday 21 Sep
    const b = shabbatBlocks({ ...s, blockHolidays: false }, '2026-09-20T00:00:00Z', '2026-09-22T00:00:00Z')
    expect(b).toHaveLength(0)
  })
})
