# Deploy / פריסה

[עברית](#עברית) · [English](#english)

---

<div dir="rtl">

## עברית

### מה מתקבל
- **Cloudflare Pages**: האתר הסטטי (חינם, עובד גם עם ריפו פרטי). כותרות אבטחה ב-`public/_headers`.
- **Supabase**: מסד נתונים, התחברות אמיתית ו-Edge Functions (API, MCP, תזכורות, Webhooks, WhatsApp, Stripe).
- **Google**: יומן, Meet ו-Gmail מהדפדפן של המארח.
- **GitHub Pages**: אופציונלי, כבוי כברירת מחדל (`PAGES_ENABLED`).

### מצב דמו מול Supabase
| | דמו (בלי Supabase) | עם Supabase |
| --- | --- | --- |
| נתונים | בדפדפן של כל מבקר (localStorage). לכל מבקר עותק משלו | במסד נתונים משותף |
| הזמנות ממכשיר אחר | **לא מגיעות למארח**. מוזמן שקובע בטלפון שלו שומר אצלו בלבד | מגיעות למארח בזמן אמת |
| התחברות | כפתור כניסה מהירה | אימייל + סיסמה, קישור קסם, Google, Microsoft |
| API, MCP, תזכורות בשרת, WhatsApp, Stripe | לא | כן (Edge Functions) |
| Google Calendar / Gmail | כן, אם הוגדר Client ID | כן |

מסקנה: דמו טוב להצגה ולבדיקות. לשימוש אמיתי עם מוזמנים צריך Supabase.

### 1. Cloudflare Pages (בוחרים דרך אחת)
**דרך א: חיבור Git בלוח הבקרה (הכי פשוט)**
1. dash.cloudflare.com > Workers & Pages > Create > Pages > Connect to Git. מאשרים ל-Cloudflare גישה לריפו הפרטי.
2. Production branch: `main`. Framework preset: None. Build command: `npm run build`. Output: `dist`.
3. Environment variables (Production וגם Preview): `NODE_VERSION=22`, ואם יש: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_GOOGLE_CLIENT_ID`.
4. Save and Deploy. הכתובת: `https://slotwise.pages.dev` (או שם אחר אם תפוס).
5. **לא** מגדירים את הסודות `CLOUDFLARE_*` ב-GitHub, כדי שה-Action לא יפרוס פעם שנייה.

**דרך ב: GitHub Action** (`.github/workflows/deploy-cloudflare.yml`)
1. Cloudflare > My Profile > API Tokens > Create Token > תבנית "Edit Cloudflare Workers" או Custom עם Account > Cloudflare Pages > Edit.
2. GitHub > Settings > Secrets and variables > Actions > **Secrets**: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` (מופיע בלוח הבקרה בצד ימין).
3. אותו מסך > **Variables**: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_GOOGLE_CLIENT_ID` (אופציונלי).
4. כל push ל-`main` מריץ בדיקות, בונה ופורס. בלי הסודות העבודה מדולגת והריצה נשארת ירוקה. הפרויקט `slotwise` נוצר בריצה הראשונה.

מקומית: `npx wrangler login` ואז `npm run deploy:cloudflare`.

הערות CSP: `frame-ancestors *` כי דף ההזמנה מוטמע באתרים אחרים, ו-`_headers` לא יכול להבדיל בין נתיבי hash. `connect-src` כולל `https:` כי מארחים יכולים להגדיר Webhook לכל כתובת והדפדפן שולח אותו. פרטים בהערות בקובץ.

### 2. Supabase
1. supabase.com > New project (אזור קרוב, למשל Frankfurt). שומרים את סיסמת מסד הנתונים.
2. `cp .env.supabase.example .env.supabase`, ממלאים `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`, `SUPABASE_SERVICE_ROLE_KEY`, `APP_URL` ומה שרוצים מהשאר.
3. `bash scripts/setup-supabase.sh`: התחברות, link, `db push` (המיגרציות 001 ו-002), סודות, פריסת 6 הפונקציות, סוד ב-Vault ותזמון pg_cron. בסוף מודפסים ה-URL והמקום של המפתח הציבורי.
4. מעתיקים `VITE_SUPABASE_URL` ו-`VITE_SUPABASE_ANON_KEY` ל-Cloudflare (או למשתני GitHub) ובונים מחדש.
5. Authentication > URL Configuration: Site URL `https://slotwise.pages.dev`, Redirect URLs: `https://slotwise.pages.dev/**`, `https://*.slotwise.pages.dev/**`, `http://localhost:5173/**`, והדומיין שלכם. (אותם ערכים ב-`supabase/config.toml`, אפשר לדחוף עם `supabase config push`.)
6. Authentication > Providers: Google (Client ID + Secret מסעיף 3) ו-Azure לפי הצורך. Callback: `https://<ref>.supabase.co/auth/v1/callback`.
7. Database > Webhooks: טבלה `records`, Insert + Update, פונקציה `webhooks`, כותרת `x-slotwise-db-secret`. פרטים ב-[SERVER.md](SERVER.md).
8. אוטומציה: GitHub Secrets `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`, ואז כל שינוי ב-`supabase/**` ב-`main` מריץ `db push` ופורס פונקציות. אם הרצתם את `schema.sql` ידנית בעבר: `supabase migration repair --status applied 001 002` פעם אחת.

### 3. Google (יומן, Meet, Gmail, כניסה עם Google)
1. console.cloud.google.com > פרויקט חדש.
2. APIs & Services > Library: מפעילים **Google Calendar API** ו-**Gmail API**.
3. Google Auth Platform (OAuth consent screen): External. שם, אימייל תמיכה, Authorized domains (הדומיין שלכם). Data access: `calendar.events`, `calendar.readonly`, `gmail.send`, `openid`, `email`, `profile`.
4. Audience: במצב **Testing** רק משתמשי בדיקה (עד 100) שהוספתם יכולים להתחבר. מוסיפים את עצמכם ב-Test users.
5. **Production**: `gmail.send` והרשאות היומן הן "sensitive", לכן צריך אימות של Google (מדיניות פרטיות ותנאים בדומיין שלכם, סרטון הדגמה, אימות בעלות על הדומיין ב-Search Console). עד שמאושר, משתמשים רואים אזהרת "האפליקציה לא אומתה" ויש מגבלה של 100 משתמשים. עדיף דומיין משלכם ולא `pages.dev`.
6. Credentials > Create credentials > OAuth client ID > **Web application**.
   - Authorized JavaScript origins: `http://localhost:5173`, `https://slotwise.pages.dev`, `https://slotwise.example.com` (הדומיין שלכם). בלי נתיב ובלי `/` בסוף. אין wildcard, כך שכתובות Preview לא יעבדו עם Google אלא אם מוסיפים אותן.
   - Authorized redirect URIs (רק לכניסה עם Google דרך Supabase): `https://<ref>.supabase.co/auth/v1/callback`.
7. ה-Client ID נכנס ל-`VITE_GOOGLE_CLIENT_ID`: משתנה סביבה ב-Cloudflare Pages (דרך א) או משתנה ריפו ב-GitHub (דרך ב), ובונים מחדש. אפשר גם להדביק באפליקציה: הגדרות > אינטגרציות (נשמר בדפדפן בלבד). ה-Client Secret הולך רק ל-Supabase.

### 4. דומיין משלכם
1. Pages > slotwise > Custom domains > Set up a custom domain. אם הדומיין ב-Cloudflare DNS זה אוטומטי; אחרת CNAME של תת-דומיין ל-`slotwise.pages.dev` (דומיין ראשי דורש nameservers של Cloudflare).
2. מעדכנים: Google JavaScript origins, Supabase Site URL + Redirect URLs, הסוד `APP_URL` (`supabase secrets set APP_URL=https://.../`), וקישורי embed קיימים.

### 5. עלויות (שכבות חינם, נכון לכתיבה; בדקו בדפי המחירים)
- Cloudflare Pages: חינם. בקשות ותעבורה לאתר סטטי ללא הגבלה, 500 בניות בחודש.
- Supabase Free: 500MB מסד נתונים, 50,000 משתמשים פעילים בחודש, 500,000 הפעלות Edge Function, 5GB תעבורה. פרויקט ללא פעילות שבוע מושהה (מפעילים מחדש בלחיצה). Pro: $25 לחודש.
- Google APIs: חינם במסגרת המכסות. אימות Google: חינם.
- GitHub Actions בריפו פרטי: 2,000 דקות בחודש בחינם.
- Resend: 3,000 מיילים בחודש בחינם. WhatsApp ו-Stripe: תשלום לפי שימוש.

### 6. צ'קליסט
- [ ] Cloudflare: פרויקט `slotwise` (דרך א או ב, לא שתיהן), האתר עולה, `#/yonatan` עובד.
- [ ] כותרות: `curl -sI https://slotwise.pages.dev | grep -i content-security`.
- [ ] Supabase: `setup-supabase.sh` רץ בלי שגיאות, `VITE_SUPABASE_*` הוגדרו ונבנה מחדש, כפתור הדמו נעלם.
- [ ] Auth: Site URL ו-Redirect URLs, ספקי Google/Azure, SMTP אמיתי (השולח המובנה מוגבל לכמה מיילים בשעה).
- [ ] Database Webhook ל-`webhooks`; `select * from cron.job;` מראה `slotwise-cron`.
- [ ] Google: APIs מופעלים, Origins כוללים את כל הכתובות, Test users, `VITE_GOOGLE_CLIENT_ID` הוגדר.
- [ ] GitHub Pages: רק אם רוצים, משתנה `PAGES_ENABLED=true` ו-Pages עם מקור "GitHub Actions" (דורש תוכנית שתומכת ב-Pages לריפו פרטי).
- [ ] הזמנה מטלפון אחר מגיעה ללוח של המארח.

</div>

---

## English

### What you get
- **Cloudflare Pages** hosts the static app (free, works with a private repo). Security headers live in `public/_headers`.
- **Supabase** adds the database, real login and the Edge Functions (API, MCP, reminders, webhooks, WhatsApp, Stripe).
- **Google** adds Calendar, Meet and Gmail from the host's browser.
- **GitHub Pages** is optional and off by default (`PAGES_ENABLED`).

### Demo mode vs Supabase
| | Demo (no Supabase) | With Supabase |
| --- | --- | --- |
| Data | In each visitor's own browser (localStorage). Every visitor has a separate copy | Shared database |
| Bookings from other devices | **Never reach the host**. An invitee booking on their phone only saves it on their phone | Reach the host live |
| Login | One click demo bypass | Email + password, magic link, Google, Microsoft |
| API, MCP, server reminders, WhatsApp, Stripe | No | Yes (Edge Functions) |
| Google Calendar / Gmail | Yes, with a Client ID | Yes |

Demo is for showing and testing. Real use with invitees needs Supabase.

### 1. Cloudflare Pages (pick one way)
**A. Git integration in the dashboard (simplest)**
1. dash.cloudflare.com > Workers & Pages > Create > Pages > Connect to Git. Grant access to the private repo.
2. Production branch `main`, framework preset None, build command `npm run build`, output directory `dist`.
3. Environment variables (Production and Preview): `NODE_VERSION=22`, and optionally `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_GOOGLE_CLIENT_ID`.
4. Save and Deploy. URL: `https://slotwise.pages.dev` (or a suffixed name if taken).
5. Do **not** add the `CLOUDFLARE_*` GitHub secrets, so the Action does not deploy a second time.

**B. GitHub Action** (`.github/workflows/deploy-cloudflare.yml`)
1. Cloudflare > My Profile > API Tokens > Create Token, template "Edit Cloudflare Workers" or a custom token with Account > Cloudflare Pages > Edit.
2. GitHub > Settings > Secrets and variables > Actions > **Secrets**: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` (shown in the dashboard sidebar).
3. Same page > **Variables**: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_GOOGLE_CLIENT_ID` (optional).
4. Every push to `main` runs unit tests, builds and deploys. Without the secrets the job is skipped and the run stays green. The `slotwise` project is created on the first run.

Locally: `npx wrangler login`, then `npm run deploy:cloudflare`. Preview with headers: `npm run build && npm run preview:cloudflare` (port 8788). E2E against it: `npm run test:e2e:cf` (fails on any CSP violation).

CSP notes: `frame-ancestors *` because the booking page is embedded on other sites and `_headers` cannot match hash routes, so the whole app is frameable (no `X-Frame-Options`). `connect-src` includes `https:` because hosts can register webhook URLs that the browser delivers to. `embed.js` is served with `Access-Control-Allow-Origin: *` and `Cross-Origin-Resource-Policy: cross-origin`. Details are in comments in the file.

### 2. Supabase
1. supabase.com > New project (a nearby region, e.g. Frankfurt). Save the database password.
2. `cp .env.supabase.example .env.supabase`, fill in `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`, `SUPABASE_SERVICE_ROLE_KEY`, `APP_URL` and whichever function secrets you need.
3. `bash scripts/setup-supabase.sh`: login, link, `db push` (migrations 001 and 002), function secrets, deploys the 6 functions, Vault secret + pg_cron schedule. It ends by printing the URL and where to find the anon key. Works with CLI v2 and v3 (falls back to `npx supabase`).
4. Put `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` into Cloudflare (or the GitHub variables) and rebuild.
5. Authentication > URL Configuration: Site URL `https://slotwise.pages.dev`; Redirect URLs `https://slotwise.pages.dev/**`, `https://*.slotwise.pages.dev/**`, `http://localhost:5173/**` and your domain. The same values are in `supabase/config.toml` (`supabase config push` sends them).
6. Authentication > Sign In / Providers: Google (Client ID + secret from section 3), Azure if needed. Callback URL: `https://<ref>.supabase.co/auth/v1/callback`.
7. Database > Webhooks: table `records`, Insert + Update, Edge Function `webhooks`, header `x-slotwise-db-secret`. See [SERVER.md](SERVER.md).
8. Automation: GitHub secrets `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`; then any change under `supabase/**` on `main` runs `db push` and redeploys the functions (`.github/workflows/deploy-supabase.yml`, also runnable by hand). If you ran `schema.sql` by hand earlier, run `supabase migration repair --status applied 001 002` once.

`supabase/migrations/001_schema.sql` is a byte-for-byte copy of `supabase/schema.sql` (the tests read `schema.sql`). Change both together; the Supabase workflow fails if they differ.

### 3. Google (Calendar, Meet, Gmail, Google sign in)
1. console.cloud.google.com > new project.
2. APIs & Services > Library: enable **Google Calendar API** and **Gmail API**.
3. Google Auth Platform (OAuth consent screen): External. App name, support email, authorized domains (your domain). Data access: `calendar.events`, `calendar.readonly`, `gmail.send`, `openid`, `email`, `profile`.
4. Audience: in **Testing** only the test users you list (up to 100) can sign in. Add yourself under Test users.
5. **Production**: `gmail.send` and the Calendar scopes are *sensitive*, so Google verification is required (privacy policy and terms on your domain, a demo video, domain ownership verified in Search Console). Until approved users see "Google hasn't verified this app" and there is a 100 user cap. Use your own domain for this, not `pages.dev`.
6. Credentials > Create credentials > OAuth client ID > **Web application**:
   - Authorized JavaScript origins: `http://localhost:5173`, `https://slotwise.pages.dev`, `https://slotwise.example.com` (your domain). No path, no trailing slash. No wildcards, so preview URLs do not work with Google unless added.
   - Authorized redirect URIs (only for Google sign in through Supabase): `https://<ref>.supabase.co/auth/v1/callback`.
7. Put the Client ID in `VITE_GOOGLE_CLIENT_ID`: a Cloudflare Pages environment variable (way A) or a GitHub repository variable (way B), then rebuild. It can also be pasted in the app under Settings > Integrations (stored in that browser only). The client secret only goes to Supabase.

### 4. Custom domain
1. Pages > slotwise > Custom domains > Set up a custom domain. Automatic when the zone is on Cloudflare DNS; otherwise a CNAME from a subdomain to `slotwise.pages.dev` (an apex domain needs Cloudflare nameservers).
2. Then update: Google JavaScript origins, Supabase Site URL + Redirect URLs, the `APP_URL` function secret (`supabase secrets set APP_URL=https://.../`), and any embed snippets already shared.

### 5. Costs (free tiers at the time of writing; check the pricing pages)
- Cloudflare Pages: free. Unlimited static requests and bandwidth, 500 builds per month.
- Supabase Free: 500 MB database, 50,000 monthly active users, 500,000 Edge Function invocations, 5 GB egress. Projects are paused after a week without activity (one click to resume). Pro is $25/month.
- Google APIs: free within quota. Google verification: free.
- GitHub Actions on a private repo: 2,000 free minutes per month.
- Resend: 3,000 emails per month free. WhatsApp and Stripe: pay per use.

### 6. Checklist
- [ ] Cloudflare project `slotwise` (way A or B, not both), site loads, `#/yonatan` works.
- [ ] Headers: `curl -sI https://slotwise.pages.dev | grep -i content-security`.
- [ ] Supabase: `setup-supabase.sh` finished cleanly, `VITE_SUPABASE_*` set and rebuilt, demo bypass gone.
- [ ] Auth: Site URL and Redirect URLs, Google/Azure providers, real SMTP (the built-in sender allows only a few emails per hour).
- [ ] Database Webhook to `webhooks`; `select * from cron.job;` shows `slotwise-cron`.
- [ ] Google: APIs enabled, every origin listed, test users added, `VITE_GOOGLE_CLIENT_ID` set.
- [ ] GitHub Pages only if wanted: repository variable `PAGES_ENABLED=true` and Pages source "GitHub Actions" (needs a plan with Pages for private repos).
- [ ] A booking made on another phone shows up in the host's dashboard.
