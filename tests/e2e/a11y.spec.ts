import AxeBuilder from '@axe-core/playwright'
import { test, type Page } from '@playwright/test'
import fs from 'node:fs'
import { enterDemo, go } from './helpers'

const OUT = process.env.A11Y_DUMP!
const PUBLIC = ['/', '/guide', '/login', '/yonatan', '/yonatan/intro', '/yonatan/consult', '/team/studio', '/team/studio/discovery', '/yonatan/forms/start', 'POLL', 'BOOKING']
const APP = ['/app', '/app/bookings', '/app/event-types', 'ET', '/app/availability', '/app/workflows', '/app/routing', '/app/teams', '/app/polls', '/app/contacts', '/app/insights', '/app/integrations', '/app/developers', '/app/settings']

async function scan(page: Page, label: string) {
  await page.waitForTimeout(800)
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
  const v = r.violations.map((x) => ({ id: x.id, impact: x.impact, n: x.nodes.length, nodes: x.nodes.slice(0, 6).map((n) => ({ t: n.target.join(' '), html: n.html.slice(0, 160), s: n.failureSummary?.slice(0, 260) })) }))
  fs.appendFileSync(OUT, JSON.stringify({ label, v }) + '\n')
}

for (const mode of ['he-light', 'en-dark']) {
  test(`dump ${mode} public`, async ({ page }) => {
    test.setTimeout(240_000)
    if (mode === 'en-dark') await page.addInitScript(() => { localStorage.setItem('slotwise:locale', 'en'); localStorage.setItem('slotwise:theme', 'dark') })
    for (const r of PUBLIC) {
      if (r === 'POLL') {
        const id = await page.evaluate(() => JSON.parse(localStorage.getItem('slotwise:db') || '{}').polls?.[0]?.id)
        await go(page, '/p/' + id)
      } else if (r === 'BOOKING') {
        await go(page, '/yonatan/intro')
        await page.locator('.ticket-list .ticket').first().click()
        await page.locator('.ticket-row.open .btn').click()
        await page.fill('input[autocomplete=name]', 'A B')
        await page.fill('input[autocomplete=email]', 'a@test.dev')
        await page.fill('input[autocomplete=tel]', '0541234567')
        await page.locator('form.booker-form button.btn-accent.btn-lg').click()
        await page.waitForURL(/#\/b\//)
      } else await go(page, r)
      await scan(page, mode + ' ' + r)
    }
  })
  test(`dump ${mode} app`, async ({ page }) => {
    test.setTimeout(240_000)
    if (mode === 'en-dark') await page.addInitScript(() => { localStorage.setItem('slotwise:locale', 'en'); localStorage.setItem('slotwise:theme', 'dark') })
    await enterDemo(page)
    for (const r of APP) {
      if (r === 'ET') {
        const id = await page.evaluate(() => JSON.parse(localStorage.getItem('slotwise:db') || '{}').eventTypes?.[0]?.id)
        await go(page, '/app/event-types/' + id)
      } else await go(page, r)
      await scan(page, mode + ' ' + r)
    }
  })
}
