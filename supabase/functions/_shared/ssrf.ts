/**
 * Outbound URL policy for host-configured destinations (webhooks, workflow webhook steps).
 * Rules: https only, no credentials, no localhost / *.localhost / *.local / *.internal / single label
 * hosts, no IP literal in a private, loopback, link-local, CGNAT, metadata or other reserved range,
 * and (when DNS resolution is available) no hostname that resolves to such an address.
 * Callers fetch with redirect: 'manual', so a redirect cannot reach an internal address either.
 * Limit: the address is resolved again by fetch, so DNS rebinding between check and connect is
 * not fully excluded.
 */

export type DnsResolver = (host: string, type: 'A' | 'AAAA') => Promise<string[]>

/** Generic error stored in delivery logs instead of network error details. */
export const BLOCKED_DESTINATION = 'blocked destination'
export const NETWORK_ERROR = 'network error'

function v4Parts(ip: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip)
  if (!m) return null
  const p = m.slice(1).map(Number)
  return p.every((x) => x >= 0 && x <= 255) ? p : null
}

export function isPrivateIPv4(ip: string): boolean {
  const p = v4Parts(ip)
  if (!p) return false
  const [a, b, c] = p
  return (
    a === 0 || // this network
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local, cloud metadata 169.254.169.254
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) || // IETF protocol assignments, TEST-NET-1
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224 // multicast, reserved, broadcast
  )
}

/** Expands an IPv6 literal (no brackets, no zone) to 8 hextets, or null. */
function v6Hextets(ip: string): number[] | null {
  let s = ip.toLowerCase()
  if (s.includes('%')) s = s.slice(0, s.indexOf('%'))
  // embedded IPv4 tail (::ffff:1.2.3.4)
  const tail = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(s)
  if (tail) {
    const p = v4Parts(tail[1])
    if (!p) return null
    s = s.slice(0, -tail[1].length) + ((p[0] << 8) | p[1]).toString(16) + ':' + ((p[2] << 8) | p[3]).toString(16)
  }
  const halves = s.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : []
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0
  if (fill < 0) return null
  const all = [...head, ...Array(fill).fill('0'), ...rest]
  if (all.length !== 8 || !all.every((h) => /^[0-9a-f]{1,4}$/.test(h))) return null
  return all.map((h) => parseInt(h, 16))
}

export function isPrivateIPv6(ip: string): boolean {
  const h = v6Hextets(ip)
  if (!h) return false
  if (h.every((x) => x === 0)) return true // ::
  if (h.slice(0, 7).every((x) => x === 0) && h[7] === 1) return true // ::1
  // IPv4-mapped / compatible / NAT64: judge the embedded IPv4
  const v4 = `${h[6] >> 8}.${h[6] & 255}.${h[7] >> 8}.${h[7] & 255}`
  if (h.slice(0, 5).every((x) => x === 0) && (h[5] === 0xffff || h[5] === 0)) return isPrivateIPv4(v4)
  if (h[0] === 0x64 && h[1] === 0xff9b) return isPrivateIPv4(v4)
  if ((h[0] & 0xfe00) === 0xfc00) return true // unique local fc00::/7 (incl. fd00:ec2::254 metadata)
  if ((h[0] & 0xffc0) === 0xfe80) return true // link-local
  if ((h[0] & 0xff00) === 0xff00) return true // multicast
  if (h[0] === 0x2001 && h[1] === 0x0db8) return true // documentation
  return false
}

export function isPrivateIp(ip: string): boolean {
  return v4Parts(ip) ? isPrivateIPv4(ip) : isPrivateIPv6(ip)
}

const isIpLiteral = (host: string) => !!v4Parts(host) || !!v6Hextets(host)

/** Static checks only (no DNS). Returns a reason, or null when allowed. */
export function urlPolicyError(raw: string): string | null {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return 'invalid url'
  }
  if (u.protocol !== 'https:') return 'https required'
  if (u.username || u.password) return 'credentials in url'
  if (u.port && u.port !== '443') return 'port not allowed'
  let host = u.hostname.toLowerCase().replace(/\.$/, '')
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1)
  if (!host) return 'invalid host'
  if (isIpLiteral(host)) return isPrivateIp(host) ? 'private address' : null
  if (!host.includes('.')) return 'single label host'
  if (host === 'localhost' || /\.(localhost|local|internal|home\.arpa|lan|corp|intranet)$/.test(host)) return 'internal host'
  return null
}

/** Default resolver: Deno.resolveDns when the runtime offers it, otherwise none. */
export function defaultResolver(): DnsResolver | null {
  // deno-lint-ignore no-explicit-any
  const d = (globalThis as any).Deno
  return typeof d?.resolveDns === 'function' ? (host, type) => d.resolveDns(host, type) : null
}

/**
 * Full check: static rules, then DNS (A and AAAA). Any private answer blocks the URL; a host with no
 * answers at all is blocked. If DNS is not available (no permission / unsupported runtime) only the
 * static rules apply.
 */
export async function checkOutboundUrl(raw: string, resolve: DnsResolver | null = defaultResolver()): Promise<string | null> {
  const stat = urlPolicyError(raw)
  if (stat) return stat
  const host = new URL(raw).hostname.toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '')
  if (isIpLiteral(host) || !resolve) return null
  const answers: string[] = []
  for (const type of ['A', 'AAAA'] as const) {
    try {
      answers.push(...(await resolve(host, type)))
    } catch (e) {
      if ((e as Error)?.name !== 'NotFound') return null // DNS not usable here (permission, unsupported): static rules only
    }
  }
  if (!answers.length) return 'unresolvable host'
  return answers.some((a) => isPrivateIp(a)) ? 'resolves to a private address' : null
}
