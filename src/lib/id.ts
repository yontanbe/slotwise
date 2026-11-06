export function uid(len = 12): string {
  const a = new Uint8Array(len)
  crypto.getRandomValues(a)
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789'
  return Array.from(a, (x) => chars[x % chars.length]).join('')
}
export const token = () => uid(24)
export const nowISO = () => new Date().toISOString()
export function slugify(s: string): string {
  const latin = s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\u0590-\u05ff]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return latin || uid(6)
}

/** Path segments the router uses; they can never be usernames. */
export const RESERVED_USERNAMES = ['app', 'login', 'guide', 'onboarding', 'team', 'b', 'p', 'd', 'api', 'admin', 'embed', 'forms', 'settings', 'help', 'support', 'www', 'slotwise']
export const isReservedUsername = (u: string) => RESERVED_USERNAMES.includes(u.toLowerCase())
