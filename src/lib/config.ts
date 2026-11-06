export interface RuntimeConfig {
  supabaseUrl: string
  supabaseAnonKey: string
  googleClientId: string
}

const KEY = 'slotwise:config'

function readLocal(): Partial<RuntimeConfig> {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}')
  } catch {
    return {}
  }
}

export function getConfig(): RuntimeConfig {
  const local = readLocal()
  const env = import.meta.env
  return {
    supabaseUrl: local.supabaseUrl || env.VITE_SUPABASE_URL || '',
    supabaseAnonKey: local.supabaseAnonKey || env.VITE_SUPABASE_ANON_KEY || '',
    googleClientId: local.googleClientId || env.VITE_GOOGLE_CLIENT_ID || '',
  }
}

export function setConfig(patch: Partial<RuntimeConfig>) {
  const next = { ...readLocal(), ...patch }
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* storage blocked */
  }
}

export const isSupabaseMode = () => {
  const c = getConfig()
  return !!(c.supabaseUrl && c.supabaseAnonKey)
}

/** Base URL of the Supabase Edge Functions, when a backend is connected. */
export const functionsUrl = () => {
  const c = getConfig()
  return c.supabaseUrl ? `${c.supabaseUrl.replace(/\/$/, '')}/functions/v1` : ''
}
