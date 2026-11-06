// Tiny CSP report collector (and cross-origin embed host page) for playwright.cf.config.ts. Appends each report to test-results/csp-violations.jsonl.
import { createServer } from 'node:http'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'

const FILE = 'test-results/csp-violations.jsonl'
mkdirSync('test-results', { recursive: true })
writeFileSync(FILE, '')
createServer((req, res) => {
  if (req.method === 'POST') {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      appendFileSync(FILE, body.replace(/\n/g, ' ') + '\n')
      res.writeHead(204).end()
    })
    return
  }
  const url = new URL(req.url, 'http://x')
  if (url.pathname === '/embed-host') {
    // A "customer site" on another origin that embeds the app (used by tests/cf/csp.spec.ts).
    const app = url.searchParams.get('app') || 'http://localhost:8788/'
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(`<!doctype html><title>host</title><div data-slotwise="${app}#/yonatan"></div><script src="${app}embed.js"></script>`)
    return
  }
  res.writeHead(200, { 'content-type': 'text/plain' }).end('ok')
}).listen(8789, () => console.log('csp collector on 8789'))
