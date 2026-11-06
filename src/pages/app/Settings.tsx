import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth, useMe } from '../../auth/AuthProvider'
import PageHead from '../../components/PageHead'
import { Avatar, Field, Icon, TimezoneSelect, Toggle, useToast } from '../../components/ui'
import type { ExportBundle } from '../../data/store'
import { useStore, useSupabase } from '../../data/StoreProvider'
import { uid } from '../../lib/id'
import { useI18n } from '../../i18n'
import { CITIES } from '../../lib/holidays'
import { getTheme, setTheme, type ThemePref } from '../../lib/theme'
import type { User } from '../../lib/types'

export default function Settings() {
  const me = useMe()
  const { refresh, signOut } = useAuth()
  const sb = useSupabase()
  const store = useStore()
  const toast = useToast()
  const nav = useNavigate()
  const { L, locale, setLocale, setHour12 } = useI18n()
  const [u, setU] = useState<User>(me)
  const [theme, setThemeState] = useState<ThemePref>(getTheme())
  const [blocked, setBlocked] = useState(me.blockedEmails.join('\n'))
  const dirty = JSON.stringify(u) !== JSON.stringify(me) || blocked !== me.blockedEmails.join('\n')

  const save = async () => {
    const username = u.username.toLowerCase().replace(/[^a-z0-9-_]/g, '')
    if (username.length < 3) return toast(L('שם משתמש של 3 תווים לפחות', 'Username needs 3+ characters'), true)
    if (username !== me.username && !(await store.isUsernameFree(username, me.id))) return toast(L('שם המשתמש תפוס', 'Username is taken'), true)
    const previousUsernames = username !== me.username ? Array.from(new Set([...me.previousUsernames, me.username])).filter((x) => x !== username) : me.previousUsernames
    await store.saveUser({ ...u, username, previousUsernames, blockedEmails: blocked.split(/[\n,]/).map((x) => x.trim().toLowerCase()).filter(Boolean) })
    await refresh()
    setLocale(u.locale)
    setHour12(u.timeFormat === '12h')
    toast(L('נשמר', 'Saved'))
  }

  const exportJson = async () => {
    const data = await store.exportAll(me.id)
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
    a.download = `slotwise-${me.username}-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
  }
  const importJson = async (f: File) => {
    try {
      const data = JSON.parse(await f.text()) as ExportBundle
      if (data.version !== 1 || !data.user) throw new Error('bad file')
      if (!window.confirm(L('הייבוא יחליף את כל הנתונים הנוכחיים בחשבון. להמשיך?', 'Import replaces all current data in this account. Continue?'))) return
      await store.importAll(me.id, data)
      await refresh()
      toast(L('יובא', 'Imported'))
    } catch (e) {
      toast(String((e as Error).message), true)
    }
  }
  const deleteAccount = async () => {
    if (window.prompt(L('הקלידו DELETE למחיקת כל הנתונים', 'Type DELETE to erase all data')) !== 'DELETE') return
    await store.deleteAccount(me.id)
    await signOut()
    nav('/')
  }

  const set = <K extends keyof User>(k: K, v: User[K]) => setU({ ...u, [k]: v })

  return (
    <div className="stack" style={{ ['--gap' as string]: '24px' }}>
      <PageHead title={L('הגדרות', 'Settings')} actions={<button className="btn btn-accent" disabled={!dirty} onClick={save}>{L('שמירה', 'Save')}</button>} />

      <section className="settings-sec">
        <div>
          <h3>{L('פרופיל', 'Profile')}</h3>
          <p className="small muted">{L('מה שהמוזמנים רואים.', 'What invitees see.')}</p>
        </div>
        <div className="card stack" style={{ ['--gap' as string]: '16px' }}>
          <div className="row" style={{ gap: 14 }}>
            <Avatar name={u.name} src={u.avatarUrl} size={64} />
            <Field label={L('קישור לתמונה', 'Avatar URL')}>
              <input className="input ltr" value={u.avatarUrl} onChange={(e) => set('avatarUrl', e.target.value)} placeholder="https://" />
            </Field>
          </div>
          <div className="grid-2">
            <Field label={L('שם', 'Name')}>
              <input className="input" value={u.name} onChange={(e) => set('name', e.target.value)} />
            </Field>
            <Field label={L('שם משתמש', 'Username')} hint={me.previousUsernames.length ? L(`הפניות פעילות: ${me.previousUsernames.join(', ')}`, `Redirects: ${me.previousUsernames.join(', ')}`) : L('קישורים ישנים יופנו אוטומטית', 'Old links redirect automatically')}>
              <div className="input-group ltr">
                <span className="addon">slotwise/</span>
                <input className="input" value={u.username} onChange={(e) => set('username', e.target.value)} />
              </div>
            </Field>
          </div>
          <Field label={L('ביו', 'Bio')}>
            <textarea className="textarea" value={u.bio} onChange={(e) => set('bio', e.target.value)} />
          </Field>
          <div className="grid-2">
            <Field label={L('מייל', 'Email')}>
              <input className="input ltr" value={u.email} disabled />
            </Field>
            <Field label={L('טלפון / WhatsApp', 'Phone / WhatsApp')}>
              <input className="input ltr" value={u.phone} onChange={(e) => set('phone', e.target.value)} />
            </Field>
          </div>
        </div>
      </section>

      <section className="settings-sec">
        <div>
          <h3>{L('העדפות', 'Preferences')}</h3>
        </div>
        <div className="card stack" style={{ ['--gap' as string]: '16px' }}>
          <div className="grid-2">
            <Field label={L('שפה', 'Language')}>
              <select className="select" value={u.locale} onChange={(e) => set('locale', e.target.value as User['locale'])}>
                <option value="he">עברית</option>
                <option value="en">English</option>
              </select>
            </Field>
            <Field label={L('אזור זמן', 'Timezone')}>
              <TimezoneSelect value={u.timezone} onChange={(tz) => set('timezone', tz)} />
            </Field>
          </div>
          <div className="grid-3">
            <Field label={L('השבוע מתחיל ב', 'Week starts on')}>
              <select className="select" value={u.weekStart} onChange={(e) => set('weekStart', Number(e.target.value) as User['weekStart'])}>
                <option value={0}>{L('ראשון', 'Sunday')}</option>
                <option value={1}>{L('שני', 'Monday')}</option>
                <option value={6}>{L('שבת', 'Saturday')}</option>
              </select>
            </Field>
            <Field label={L('פורמט שעה', 'Time format')}>
              <div className="seg">
                <button aria-pressed={u.timeFormat === '24h'} onClick={() => set('timeFormat', '24h')}>24h</button>
                <button aria-pressed={u.timeFormat === '12h'} onClick={() => set('timeFormat', '12h')}>12h</button>
              </div>
            </Field>
            <Field label={L('מראה', 'Theme')}>
              <div className="seg">
                {(['light', 'dark', 'system'] as const).map((t) => (
                  <button key={t} aria-pressed={theme === t} onClick={() => { setTheme(t); setThemeState(t) }}>
                    {t === 'light' ? L('בהיר', 'Light') : t === 'dark' ? L('כהה', 'Dark') : L('מערכת', 'System')}
                  </button>
                ))}
              </div>
            </Field>
          </div>
          {locale !== u.locale && <p className="tiny muted">{L('שפת הממשק תתעדכן בשמירה.', 'Interface language updates on save.')}</p>}
        </div>
      </section>

      <section className="settings-sec">
        <div>
          <h3>{L('שבת וחגים', 'Shabbat and holidays')}</h3>
          <p className="small muted">{L('מהדלקת נרות ועד הבדלה, לפי העיר.', 'From candle lighting to havdalah, by city.')}</p>
        </div>
        <div className="card stack" style={{ ['--gap' as string]: '14px' }}>
          <label className="row" style={{ gap: 10 }}>
            <Toggle checked={u.shabbat.enabled} onChange={(v) => set('shabbat', { ...u.shabbat, enabled: v })} />
            {L('לחסום שבתות', 'Block Shabbat')}
          </label>
          <label className="row" style={{ gap: 10 }}>
            <Toggle checked={u.shabbat.blockHolidays} onChange={(v) => set('shabbat', { ...u.shabbat, blockHolidays: v })} />
            {L('לחסום חגים (יום טוב)', 'Block holidays (Yom Tov)')}
          </label>
          <label className="row" style={{ gap: 10 }}>
            <Toggle checked={u.shabbat.showHebrewDate} onChange={(v) => set('shabbat', { ...u.shabbat, showHebrewDate: v })} />
            {L('תאריך עברי בדף ההזמנה', 'Hebrew date on booking page')}
          </label>
          <Field label={L('עיר', 'City')}>
            <select className="select" value={u.shabbat.city} onChange={(e) => set('shabbat', { ...u.shabbat, city: e.target.value })}>
              {CITIES.map((c) => <option key={c.key} value={c.key}>{locale === 'he' ? c.he : c.en}</option>)}
            </select>
          </Field>
        </div>
      </section>

      <section className="settings-sec">
        <div>
          <h3>{L('הגנה מספאם', 'Spam protection')}</h3>
          <p className="small muted">{L('מיילים או דומיינים שלא יוכלו להזמין.', 'Emails or domains that cannot book.')}</p>
        </div>
        <div className="card">
          <textarea className="textarea ltr" value={blocked} onChange={(e) => setBlocked(e.target.value)} placeholder={'spam@example.com\n@mailinator.com'} />
        </div>
      </section>

      <section className="settings-sec">
        <div>
          <h3>{L('מחוץ למשרד', 'Out of office')}</h3>
          <p className="small muted">{L('חוסם את התאריכים ומציע למוזמנים מחליף.', 'Blocks the dates and offers invitees a teammate.')}</p>
        </div>
        <div className="card stack" style={{ ['--gap' as string]: '10px' }}>
          {(u.outOfOffice || []).map((o, i) => (
            <div key={o.id} className="row wrap" style={{ gap: 6 }}>
              <input className="input input-sm ltr" type="date" style={{ width: 150 }} value={o.start} onChange={(e) => set('outOfOffice', u.outOfOffice!.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))} />
              <span className="muted">–</span>
              <input className="input input-sm ltr" type="date" style={{ width: 150 }} value={o.end} onChange={(e) => set('outOfOffice', u.outOfOffice!.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))} />
              <input className="input input-sm grow" placeholder={L('הערה למוזמנים', 'Note for invitees')} value={o.note} onChange={(e) => set('outOfOffice', u.outOfOffice!.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)))} />
              <input className="input input-sm ltr" style={{ width: 140 }} placeholder={L('מחליף (username)', 'Teammate username')} value={o.redirectUsername || ''} onChange={(e) => set('outOfOffice', u.outOfOffice!.map((x, j) => (j === i ? { ...x, redirectUsername: e.target.value.trim() || undefined } : x)))} />
              <button className="icon-btn" onClick={() => set('outOfOffice', u.outOfOffice!.filter((_, j) => j !== i))}><Icon name="x" size={13} /></button>
            </div>
          ))}
          <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => { const d = new Date().toISOString().slice(0, 10); set('outOfOffice', [...(u.outOfOffice || []), { id: uid(6), start: d, end: d, note: '' }]) }}>
            <Icon name="plus" size={14} /> {L('הוספת תקופה', 'Add period')}
          </button>
        </div>
      </section>

      <section className="settings-sec">
        <div>
          <h3>{L('נסיעות', 'Travel')}</h3>
          <p className="small muted">{L('בתאריכים האלה שעות העבודה חלות באזור זמן אחר.', 'On these dates your hours apply in another timezone.')}</p>
        </div>
        <div className="card stack" style={{ ['--gap' as string]: '10px' }}>
          {(u.travel || []).map((t, i) => (
            <div key={t.id} className="row wrap" style={{ gap: 6 }}>
              <input className="input input-sm ltr" type="date" style={{ width: 150 }} value={t.start} onChange={(e) => set('travel', u.travel!.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))} />
              <span className="muted">–</span>
              <input className="input input-sm ltr" type="date" style={{ width: 150 }} value={t.end} onChange={(e) => set('travel', u.travel!.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))} />
              <div style={{ minWidth: 220, flex: 1 }}><TimezoneSelect className="select input-sm" value={t.timezone} onChange={(tz) => set('travel', u.travel!.map((x, j) => (j === i ? { ...x, timezone: tz } : x)))} /></div>
              <button className="icon-btn" onClick={() => set('travel', u.travel!.filter((_, j) => j !== i))}><Icon name="x" size={13} /></button>
            </div>
          ))}
          <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => { const d = new Date().toISOString().slice(0, 10); set('travel', [...(u.travel || []), { id: uid(6), start: d, end: d, timezone: 'Europe/London' }]) }}>
            <Icon name="plus" size={14} /> {L('הוספת נסיעה', 'Add trip')}
          </button>
        </div>
      </section>

      {sb && <MfaSection />}

      <section className="settings-sec">
        <div>
          <h3>{L('נתונים', 'Data')}</h3>
          <p className="small muted">{L('הנתונים שלך שייכים לך.', 'Your data is yours.')}</p>
        </div>
        <div className="card row wrap" style={{ gap: 10 }}>
          <button className="btn btn-line" onClick={exportJson}><Icon name="download" size={15} /> {L('ייצוא JSON', 'Export JSON')}</button>
          <label className="btn btn-line">
            <Icon name="upload" size={15} /> {L('ייבוא', 'Import')}
            <input type="file" accept="application/json" hidden onChange={(e) => e.target.files?.[0] && importJson(e.target.files[0])} />
          </label>
          <button className="btn btn-danger" onClick={deleteAccount}><Icon name="trash" size={15} /> {L('מחיקת חשבון', 'Delete account')}</button>
        </div>
      </section>
    </div>
  )
}

function MfaSection() {
  const sb = useSupabase()!
  const toast = useToast()
  const { L } = useI18n()
  const [factors, setFactors] = useState<{ id: string; status: string }[] | null>(null)
  const [enroll, setEnroll] = useState<{ id: string; qr: string; secret: string } | null>(null)
  const [code, setCode] = useState('')
  const load = async () => {
    const { data } = await sb.auth.mfa.listFactors()
    setFactors((data?.totp ?? []).map((f) => ({ id: f.id, status: f.status })))
  }
  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const verified = (factors ?? []).filter((f) => f.status === 'verified')
  return (
    <section className="settings-sec">
      <div>
        <h3>{L('אימות דו-שלבי', 'Two factor authentication')}</h3>
        <p className="small muted">{L('קוד מאפליקציה (Google Authenticator, 1Password) בכל כניסה.', 'A code from an authenticator app at every sign in.')}</p>
      </div>
      <div className="card stack" style={{ ['--gap' as string]: '12px' }}>
        {verified.length > 0 ? (
          <div className="row between">
            <span className="stamp ok">{L('פעיל', 'On')}</span>
            <button className="btn btn-danger btn-sm" onClick={async () => { for (const f of verified) await sb.auth.mfa.unenroll({ factorId: f.id }); await load(); toast(L('בוטל', 'Disabled')) }}>{L('ביטול', 'Turn off')}</button>
          </div>
        ) : enroll ? (
          <div className="stack" style={{ ['--gap' as string]: '10px' }}>
            <img src={enroll.qr} alt="QR" style={{ width: 180, height: 180, background: '#fff', borderRadius: 8 }} />
            <div className="tiny muted ltr mono">{enroll.secret}</div>
            <div className="row" style={{ gap: 8 }}>
              <input className="input input-sm ltr mono" style={{ width: 120 }} maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} placeholder="123456" />
              <button className="btn btn-sm" disabled={code.length !== 6} onClick={async () => {
                const { data: ch, error: e1 } = await sb.auth.mfa.challenge({ factorId: enroll.id })
                if (e1 || !ch) return toast(e1?.message ?? 'error', true)
                const { error } = await sb.auth.mfa.verify({ factorId: enroll.id, challengeId: ch.id, code })
                if (error) return toast(error.message, true)
                setEnroll(null)
                setCode('')
                await load()
                toast(L('הופעל', 'Enabled'))
              }}>{L('אישור', 'Confirm')}</button>
            </div>
          </div>
        ) : (
          <button className="btn btn-line btn-sm" style={{ alignSelf: 'flex-start' }} onClick={async () => {
            const { data, error } = await sb.auth.mfa.enroll({ factorType: 'totp' })
            if (error || !data) return toast(error?.message ?? 'error', true)
            setEnroll({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret })
          }}>{L('הפעלה', 'Turn on')}</button>
        )}
      </div>
    </section>
  )
}
