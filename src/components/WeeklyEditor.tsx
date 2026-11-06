import { useI18n } from '../i18n'
import type { TimeRange } from '../lib/types'
import { Icon, Toggle } from './ui'

export function RangeEditor({ ranges, onChange, label }: { ranges: TimeRange[]; onChange: (r: TimeRange[]) => void; label?: string }) {
  const { L } = useI18n()
  return (
    <div className="stack" style={{ ['--gap' as string]: '6px' }}>
      {ranges.map((r, i) => (
        <div key={i} className="row" style={{ gap: 6 }}>
          <input aria-label={`${label ?? ''} ${L('התחלה', 'start')} ${i + 1}`} className="input input-sm ltr time-in" type="time" value={r.start} onChange={(e) => onChange(ranges.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))} />
          <span className="muted">–</span>
          <input aria-label={`${label ?? ''} ${L('סיום', 'end')} ${i + 1}`} className="input input-sm ltr time-in" type="time" value={r.end === '24:00' ? '23:59' : r.end} onChange={(e) => onChange(ranges.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))} />
          <button type="button" className="icon-btn" onClick={() => onChange(ranges.filter((_, j) => j !== i))} aria-label={L('הסרה', 'Remove')}>
            <Icon name="x" size={14} />
          </button>
          {i === ranges.length - 1 && (
            <button type="button" className="icon-btn" onClick={() => onChange([...ranges, { start: r.end < '20:00' ? addHour(r.end) : '18:00', end: r.end < '20:00' ? addHour(addHour(r.end)) : '20:00' }])} aria-label={L('טווח נוסף', 'Add range')}>
              <Icon name="plus" size={14} />
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

function addHour(t: string) {
  const [h, m] = t.split(':').map(Number)
  return `${String(Math.min(23, h + 1)).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export default function WeeklyEditor({ weekly, onChange, weekStart = 0 }: { weekly: TimeRange[][]; onChange: (w: TimeRange[][]) => void; weekStart?: number }) {
  const { L, weekdayShort } = useI18n()
  const order = Array.from({ length: 7 }, (_, i) => (i + weekStart) % 7)
  const set = (d: number, r: TimeRange[]) => onChange(weekly.map((x, i) => (i === d ? r : x)))
  return (
    <div className="weekly">
      {order.map((d) => {
        const on = weekly[d].length > 0
        return (
          <div key={d} className="weekly-row">
            <div className="row" style={{ gap: 10, minWidth: 110 }}>
              <Toggle checked={on} onChange={(v) => set(d, v ? [{ start: '09:00', end: '17:00' }] : [])} label={weekdayShort(d)} />
              <b className="weekly-day">{weekdayShort(d)}</b>
            </div>
            {on ? <RangeEditor label={weekdayShort(d)} ranges={weekly[d]} onChange={(r) => set(d, r)} /> : <span className="muted small">{L('לא זמין', 'Unavailable')}</span>}
            {on && (
              <button type="button" className="icon-btn weekly-copy" onClick={() => onChange(weekly.map((x) => (x.length ? weekly[d].map((r) => ({ ...r })) : x)))} title={L('העתקה לכל הימים הפעילים', 'Copy to all active days')} aria-label={L('העתקה', 'Copy')}>
                <Icon name="copy" size={14} />
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
