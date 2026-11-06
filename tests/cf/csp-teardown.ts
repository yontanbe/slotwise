import { existsSync, readFileSync } from 'node:fs'

/** Fails the run if any CSP report reached the collector during the suite. */
export default function cspTeardown() {
  const file = 'test-results/csp-violations.jsonl'
  const lines = existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean) : []
  if (lines.length) {
    throw new Error(`${lines.length} Content Security Policy violation report(s):\n` + lines.slice(0, 20).join('\n'))
  }
  console.log('CSP: no violation reports')
}
