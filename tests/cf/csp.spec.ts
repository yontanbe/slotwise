import { test, expect, type Page } from '@playwright/test'

// Runs against Cloudflare headers (playwright.cf.config.ts). Fails on any console message about CSP.
function watchCsp(page: Page) {
  const hits: string[] = []
  page.on('console', (m) => {
    if (/Content Security Policy|Content-Security-Policy|Refused to (load|execute|apply|connect|frame)/i.test(m.text())) hits.push(m.text())
  })
  return hits
}

test('security headers are served', async ({ request }) => {
  const r = await request.get('./')
  const h = r.headers()
  expect(h['content-security-policy']).toContain("default-src 'self'")
  expect(h['content-security-policy']).toContain('frame-ancestors *')
  expect(h['x-content-type-options']).toBe('nosniff')
  expect(h['x-frame-options']).toBeUndefined()
  const e = await request.get('./embed.js')
  expect(e.headers()['access-control-allow-origin']).toBe('*')
  expect(e.headers()['cross-origin-resource-policy']).toBe('cross-origin')
})

const routes = ['/', '/login', '/yonatan', '/team/x', '/p/x', '/b/x', '/d/x']
const appRoutes = ['/app', '/app/event-types', '/app/availability', '/app/bookings', '/app/polls', '/app/contacts', '/app/insights', '/app/integrations', '/app/settings', '/app/workflows', '/app/routing', '/app/teams', '/app/developers']

test('no CSP violations on public and app routes', async ({ page }) => {
  const hits = watchCsp(page)
  for (const r of routes) {
    await page.goto('./#' + r)
    await page.waitForLoadState('networkidle')
  }
  await page.goto('./#/login')
  await page.locator('.demo-pass button').click()
  await expect(page.locator('.rail')).toBeVisible()
  for (const r of appRoutes) {
    await page.goto('./#' + r)
    await page.waitForLoadState('networkidle')
  }
  // first event type booking page from the seeded host
  await page.goto('./#/yonatan')
  const link = page.locator('a[href*="#/yonatan/"]').first()
  if (await link.count()) {
    await link.click()
    await page.waitForLoadState('networkidle')
  }
  expect(hits, hits.join('\n')).toEqual([])
})

test('embed works from another origin without CSP errors', async ({ page, baseURL }) => {
  const hits = watchCsp(page)
  // A "customer site" on another origin (the collector, port 8789) loads embed.js and the iframe from the app.
  await page.goto(`http://127.0.0.1:8789/embed-host?app=${encodeURIComponent(baseURL!)}`)
  const frame = page.frameLocator('iframe[title=Slotwise]')
  await expect(frame.locator('body')).toBeVisible()
  await expect(frame.locator('#root > *').first()).toBeVisible({ timeout: 15_000 })
  expect(hits, hits.join('\n')).toEqual([])
})

test('CSP allows Google Identity Services, Google APIs and Supabase (stubbed network)', async ({ page }) => {
  const hits = watchCsp(page)
  await page.route('https://accounts.google.com/gsi/client', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.__gsi = 1' }))
  await page.route(/https:\/\/(www|gmail|oauth2)\.googleapis\.com\/.*|https:\/\/[a-z0-9]+\.supabase\.co\/.*|https:\/\/hooks\.example\.com\/.*/, (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{}' }),
  )
  await page.goto('./#/')
  const result = await page.evaluate(async () => {
    await new Promise<void>((ok, bad) => {
      const s = document.createElement('script')
      s.src = 'https://accounts.google.com/gsi/client'
      s.onload = () => ok()
      s.onerror = () => bad(new Error('gsi blocked'))
      document.head.appendChild(s)
    })
    const urls = [
      'https://www.googleapis.com/calendar/v3/users/me/calendarList',
      'https://gmail.googleapis.com/gmail/v1/users/me/profile',
      'https://oauth2.googleapis.com/tokeninfo',
      'https://abcdefgh.supabase.co/rest/v1/records',
      'https://hooks.example.com/slotwise', // host-configured webhook
    ]
    const codes = []
    for (const u of urls) codes.push((await fetch(u)).status)
    return { gsi: (window as any).__gsi, codes }
  })
  expect(result).toEqual({ gsi: 1, codes: [200, 200, 200, 200, 200] })
  expect(hits, hits.join('\n')).toEqual([])
})
