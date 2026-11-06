/** Small runtime helpers shared by every function. WebCrypto only, no dependencies. */

const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'

/** Same alphabet as src/lib/id.ts so ids look alike whichever side created them. */
export function uid(len = 12): string {
  const a = new Uint8Array(len)
  crypto.getRandomValues(a)
  return Array.from(a, (x) => ALPHABET[x % ALPHABET.length]).join('')
}

export const newToken = () => uid(24)
export const nowISO = () => new Date().toISOString()

const enc = new TextEncoder()

export function toHex(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export async function sha256Hex(text: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', enc.encode(text)))
}

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return toHex(await crypto.subtle.sign('HMAC', key, enc.encode(message)))
}

/** Constant time comparison for hex / ascii strings. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** Stable JSON (sorted keys) for request hashing. */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null'
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']'
  const o = v as Record<string, unknown>
  return '{' + Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + stableStringify(o[k])).join(',') + '}'
}

export function digitsOnly(phone: string): string {
  return (phone || '').replace(/\D/g, '')
}

/** E.164 digits without '+'. Israeli local numbers (05x...) get the 972 prefix. */
export function normalizePhone(phone: string, defaultCountry = '972'): string {
  let d = digitsOnly(phone)
  if (!d) return ''
  if (d.startsWith('00')) d = d.slice(2)
  else if (d.startsWith('0')) d = defaultCountry + d.slice(1)
  return d
}

/** Two numbers refer to the same line when their last 9 digits match. */
export function samePhone(a: string, b: string): boolean {
  const x = digitsOnly(a).slice(-9)
  const y = digitsOnly(b).slice(-9)
  return x.length >= 7 && x === y
}

export function env(name: string): string | undefined {
  try {
    const v = Deno.env.get(name)
    return v === '' ? undefined : v
  } catch {
    return undefined
  }
}

export function appUrl(): string {
  return (env('APP_URL') || 'http://localhost:5173/').replace(/#.*$/, '')
}

export function isIsoDate(s: unknown): s is string {
  return typeof s === 'string' && !Number.isNaN(Date.parse(s))
}

/**
 * Returns a single, trimmed, lower-cased address or null. Rejects CR/LF, commas, angle brackets
 * and anything else that could smuggle extra recipients or headers.
 */
export function safeEmail(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const e = v.trim().toLowerCase()
  if (e.length > 254 || /[\r\n,;<>"()\[\]\s]/.test(e)) return null
  return /^[^@]+@[^@]+\.[a-z]{2,}$/.test(e) ? e : null
}
