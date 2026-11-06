import type { RouteTarget, RoutingCondition, RoutingForm } from './types'

type Answers = Record<string, string | string[] | boolean>

function asText(v: unknown): string {
  if (Array.isArray(v)) return v.join(',')
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  return String(v ?? '')
}

export function conditionMatches(c: RoutingCondition, answers: Answers): boolean {
  const raw = answers[c.fieldId]
  const v = asText(raw).trim().toLowerCase()
  const want = c.value.trim().toLowerCase()
  switch (c.op) {
    case 'equals':
      return Array.isArray(raw) ? raw.map((x) => x.toLowerCase()).includes(want) : v === want
    case 'not_equals':
      return Array.isArray(raw) ? !raw.map((x) => x.toLowerCase()).includes(want) : v !== want
    case 'contains':
      return v.includes(want)
    case 'gt':
      return Number(v) > Number(want)
    case 'lt':
      return Number(v) < Number(want)
  }
}

/** First matching rule wins; otherwise the fallback. */
export function routeFor(form: Pick<RoutingForm, 'rules' | 'fallback'>, answers: Answers): RouteTarget {
  for (const r of form.rules) {
    if (!r.conditions.length) continue
    const ok = r.match === 'all' ? r.conditions.every((c) => conditionMatches(c, answers)) : r.conditions.some((c) => conditionMatches(c, answers))
    if (ok) return r.target
  }
  return form.fallback
}

export function describeTarget(t: RouteTarget, eventTitle: (id: string) => string): string {
  if (t.type === 'event') return eventTitle(t.eventTypeId)
  if (t.type === 'url') return t.url
  return t.text.slice(0, 60)
}
