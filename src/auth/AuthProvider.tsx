import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { DEMO_USER_ID, newSchedule, newUser } from '../data/defaults'
import { localFindUserByEmail, seedDemo } from '../data/local'
import { useStore, useSupabase } from '../data/StoreProvider'
import { disconnectGoogle } from '../integrations/google'
import { appUrl } from '../lib/links'
import type { User } from '../lib/types'

/**
 * One auth surface for the whole app.
 * Demo mode: everything resolves locally so the login can be passed in one click.
 * Supabase mode: the same calls go to Supabase Auth. The demo button disappears.
 */
export interface AuthApi {
  mode: 'demo' | 'supabase'
  status: 'loading' | 'in' | 'out' | 'mfa'
  verifyMfa: (code: string) => Promise<string | null>
  userId: string | null
  user: User | null
  refresh: () => Promise<void>
  enterDemo: () => Promise<void>
  signInWithPassword: (email: string, password: string) => Promise<string | null>
  signUp: (email: string, password: string, name: string) => Promise<string | null>
  signInWithMagicLink: (email: string) => Promise<string | null>
  signInWithOAuth: (provider: 'google' | 'azure') => Promise<string | null>
  signOut: () => Promise<void>
}

const Ctx = createContext<AuthApi | null>(null)
const SESSION = 'slotwise:session'

function readLocalSession(): string | null {
  try {
    return JSON.parse(localStorage.getItem(SESSION) || 'null')?.userId ?? null
  } catch {
    return null
  }
}
function writeLocalSession(userId: string | null) {
  try {
    if (userId) localStorage.setItem(SESSION, JSON.stringify({ userId, at: Date.now() }))
    else localStorage.removeItem(SESSION)
  } catch {
    /* ignore */
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const store = useStore()
  const sb = useSupabase()
  const mode = sb ? 'supabase' : 'demo'
  const [userId, setUserId] = useState<string | null>(() => (sb ? null : readLocalSession()))
  const [user, setUser] = useState<User | null>(null)
  const [status, setStatus] = useState<AuthApi['status']>('loading')

  /** Ensures a profile + default schedule exist for a fresh account. Single flight per user id. */
  const inflight = useRef(new Map<string, Promise<User>>())
  const ensureProfile = useCallback(
    (id: string, email: string, name = ''): Promise<User> => {
      const cur = inflight.current.get(id)
      if (cur) return cur
      const p = createProfile(id, email, name).finally(() => inflight.current.delete(id))
      inflight.current.set(id, p)
      return p
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store],
  )
  const createProfile = useCallback(
    async (id: string, email: string, name = '') => {
      let u = await store.getUser(id)
      if (!u) {
        u = newUser(id, email, name)
        let n = u.username
        let i = 1
        while (!(await store.isUsernameFree(n, id))) n = `${u.username}${++i}`
        u.username = n
        const sched = newSchedule(id)
        u.defaultScheduleId = sched.id
        await store.saveSchedule(sched)
        await store.saveUser(u)
      }
      return u
    },
    [store],
  )

  // Supabase session wiring
  useEffect(() => {
    if (!sb) return
    let alive = true
    sb.auth.getSession().then(({ data }) => {
      if (!alive) return
      setUserId(data.session?.user.id ?? null)
      if (!data.session) setStatus('out')
    })
    const { data: sub } = sb.auth.onAuthStateChange((_e, session) => {
      setUserId(session?.user.id ?? null)
      if (!session) {
        setUser(null)
        setStatus('out')
      }
    })
    return () => {
      alive = false
      sub.subscription.unsubscribe()
    }
  }, [sb])

  const refresh = useCallback(async () => {
    if (!userId) {
      setUser(null)
      if (!sb) setStatus('out')
      return
    }
    let u = await store.getUser(userId)
    if (!u && sb) {
      const { data } = await sb.auth.getUser()
      u = await ensureProfile(userId, data.user?.email ?? '', (data.user?.user_metadata?.full_name as string) ?? '')
    }
    if (!u) {
      writeLocalSession(null)
      setUserId(null)
      setStatus('out')
      return
    }
    setUser(u)
    if (sb) {
      // second factor: a verified TOTP factor exists but this session is still aal1
      const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel()
      if (aal && aal.nextLevel === 'aal2' && aal.currentLevel !== 'aal2') {
        setStatus('mfa')
        return
      }
    }
    setStatus('in')
  }, [userId, store, sb, ensureProfile])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => store.subscribe(() => void refresh()), [store, refresh])

  useEffect(() => {
    if (sb && userId && 'watchOwner' in store) return (store as unknown as { watchOwner: (id: string) => () => void }).watchOwner(userId)
  }, [sb, userId, store])

  const localLogin = useCallback(
    async (email: string, name = '') => {
      const existing = localFindUserByEmail(email)
      const id = existing?.id ?? 'u-' + email.toLowerCase().replace(/[^a-z0-9]/g, '')
      await ensureProfile(id, email, name)
      writeLocalSession(id)
      setUserId(id)
      return null
    },
    [ensureProfile],
  )

  const api = useMemo<AuthApi>(
    () => ({
      mode,
      status,
      userId,
      user,
      refresh,
      verifyMfa: async (code) => {
        if (!sb) return null
        const { data: f } = await sb.auth.mfa.listFactors()
        const factor = f?.totp.find((x) => x.status === 'verified')
        if (!factor) return 'no_factor'
        const { data: ch, error: e1 } = await sb.auth.mfa.challenge({ factorId: factor.id })
        if (e1 || !ch) return e1?.message ?? 'challenge_failed'
        const { error } = await sb.auth.mfa.verify({ factorId: factor.id, challengeId: ch.id, code })
        if (error) return error.message
        await refresh()
        return null
      },
      enterDemo: async () => {
        seedDemo()
        writeLocalSession(DEMO_USER_ID)
        setUserId(DEMO_USER_ID)
      },
      signInWithPassword: async (email, password) => {
        if (!sb) return localLogin(email)
        const { error } = await sb.auth.signInWithPassword({ email, password })
        return error?.message ?? null
      },
      signUp: async (email, password, name) => {
        if (!sb) return localLogin(email, name)
        const { error } = await sb.auth.signUp({ email, password, options: { data: { full_name: name }, emailRedirectTo: appUrl('/app') } })
        return error?.message ?? null
      },
      signInWithMagicLink: async (email) => {
        if (!sb) return localLogin(email)
        const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: appUrl('/app') } })
        return error?.message ?? null
      },
      signInWithOAuth: async (provider) => {
        if (!sb) return localLogin(provider === 'google' ? 'google.user@example.com' : 'microsoft.user@example.com')
        const { error } = await sb.auth.signInWithOAuth({ provider, options: { redirectTo: window.location.href.split('#')[0] } })
        return error?.message ?? null
      },
      signOut: async () => {
        disconnectGoogle()
        if (sb) await sb.auth.signOut()
        writeLocalSession(null)
        setUserId(null)
        setUser(null)
        setStatus('out')
      },
    }),
    [mode, status, userId, user, refresh, sb, localLogin],
  )

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>
}

export function useAuth() {
  const v = useContext(Ctx)
  if (!v) throw new Error('AuthProvider missing')
  return v
}

/** Signed-in user, for screens rendered inside RequireAuth. */
export function useMe(): User {
  const { user } = useAuth()
  if (!user) throw new Error('useMe outside RequireAuth')
  return user
}

export function RequireAuth({ children, allowNotOnboarded = false }: { children: ReactNode; allowNotOnboarded?: boolean }) {
  const { status, user } = useAuth()
  const loc = useLocation()
  if (status === 'loading') return <div className="boot"><span className="boot-dot" /></div>
  if (status === 'out' || status === 'mfa' || !user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname)}`} replace />
  if (!user.onboarded && !allowNotOnboarded) return <Navigate to="/onboarding" replace />
  return <>{children}</>
}
