// Copies dist/ to test-results/cf-dist and adds a CSP report-uri pointing at the local collector,
// so every CSP violation in the whole Playwright run is recorded (see playwright.cf.config.ts).
import { cpSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'

const out = 'test-results/cf-dist'
if (!existsSync('dist/_headers')) throw new Error('dist/_headers missing: run `npm run build` first')
rmSync(out, { recursive: true, force: true })
cpSync('dist', out, { recursive: true })
const h = readFileSync(`${out}/_headers`, 'utf8')
const patched = h.replace(/^(\s*Content-Security-Policy: .*)$/m, '$1; report-uri http://localhost:8789/csp')
if (patched === h) throw new Error('no Content-Security-Policy line in _headers')
writeFileSync(`${out}/_headers`, patched)
console.log('prepared', out)
