import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { getConfig, isSupabaseMode } from '../lib/config'
import { LocalStore, seedDemo } from './local'
import type { Store } from './store'
import { SupabaseStore } from './supabase'

interface Ctx {
  store: Store
  supabase: SupabaseClient | null
}
const StoreCtx = createContext<Ctx | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const value = useMemo<Ctx>(() => {
    if (isSupabaseMode()) {
      const c = getConfig()
      const sb = createClient(c.supabaseUrl, c.supabaseAnonKey, { auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true } })
      return { store: new SupabaseStore(sb), supabase: sb }
    }
    seedDemo() // sample host so /yonatan works on a fresh visit
    return { store: new LocalStore(), supabase: null }
  }, [])
  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>
}

export function useStore() {
  const v = useContext(StoreCtx)
  if (!v) throw new Error('StoreProvider missing')
  return v.store
}
export function useSupabase() {
  return useContext(StoreCtx)?.supabase ?? null
}

/** Runs an async loader and re-runs it whenever the store changes or deps change. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | undefined; loading: boolean; error: unknown; reload: () => void } {
  const store = useStore()
  const [state, setState] = useState<{ data: T | undefined; loading: boolean; error: unknown }>({ data: undefined, loading: true, error: null })
  const [tick, setTick] = useState(0)
  const fnRef = useRef(fn)
  fnRef.current = fn
  useEffect(() => store.subscribe(() => setTick((t) => t + 1)), [store])
  useEffect(() => {
    let alive = true
    fnRef
      .current()
      .then((data) => alive && setState({ data, loading: false, error: null }))
      .catch((error) => alive && setState((s) => ({ ...s, loading: false, error })))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])
  return { ...state, reload: () => setTick((t) => t + 1) }
}
