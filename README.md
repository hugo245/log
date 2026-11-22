# Studio Panel

A white-label staff panel for Roblox studios. Staff sign in, log their work, get it approved and
see every payout in one place. Leads run teams, games and deadlines, HR runs recruitment, and the
owners get payments, analytics, an audit log and a security centre.

Every deployment gets its own name, logo, colours, sign-in page, payout options and feature set
from **one file**, `studio.config.json`. Branding is config-only on purpose, so nobody can change
it from inside the panel.

---

## Features

| Area | What it does |
| --- | --- |
| **Sign-in** | Roblox, Google, or test mode. Access by Roblox group rank, Discord server, manual role, team or invite link. Owners are set from the environment. |
| **Payments** | Log work for someone, staff payment requests, approvals, payment runs, PayPal / Venmo / bank / Robux payouts, DevEx conversion, Excel export. |
| **Teams & games** | Teams, skills, game stats from Roblox, task boards, deadlines, reviews, reminders. |
| **Recruitment** | Applications, Discord ticket channels, phases, sign-off, auto-hire, analytics. |
| **Staff** | Staff database, warnings, bans, payout holds, onboarding with Terms / AUP. |
| **Admin** | Roles and permissions with hierarchy, audit log with revert, backups, announcements, security levels, session management. |

## How it fits together

```
 Browser (static site)          API (Node / Express)                Supabase (Postgres)
 index.html + assets/  ─HTTPS─▶ server.js            ─service key─▶ tables: RLS on,
 config.js (apiBase)            lib/security.js  lib/studio.js       no public access
                                bot.js (Discord, optional)
```

The browser never talks to the database. Every action goes through the API, which checks the
session, the permission and the studio's money rules each time.

---

## Install for a new studio (about 20 minutes)

### 1. Database
Create a Supabase project. In the SQL editor, run **`sql/setup.sql`**. It creates every table,
turns on row level security, adds indexes and seeds five starter roles:
**Owner, Admin, Manager, Lead, Staff**. The last query it prints should show
`rls_enabled = true` and `anon_can_select = false` for every table.

| File | When to use it |
| --- | --- |
| `sql/setup.sql` | Fresh install, or to start completely over. **Drops and recreates all tables.** |
| `sql/reset-data.sql` | Keep the tables, delete every row (requests, people, sessions, settings...), re-seed the roles. |

### 2. Sign-in apps
* **Roblox**: at [create.roblox.com/credentials](https://create.roblox.com/credentials), create an OAuth 2.0 app with scopes `openid profile` and the redirect URL `https://<your-api>/roblox-auth-callback`.
* **Google** (optional): at Google Cloud Console > APIs & Services > Credentials, create an OAuth client ID (Web application) with the redirect URI `https://<your-api>/google-auth-callback`.

### 3. API
Copy the example environment file:
```bash
cp .env.example .env
```
Fill it in (or set the same variables on your host). At minimum:

| Variable | What it is |
| --- | --- |
| `APP_ORIGIN` | URL of the website, no trailing slash |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | From Supabase > Project Settings > API |
| `ROBLOX_CLIENT_ID`, `ROBLOX_CLIENT_SECRET`, `ROBLOX_REDIRECT_URI` | From the Roblox app (only if Roblox sign-in is on) |
| `SESSION_SECRET` | Long random string (command below) |
| `OWNER_ROBLOX_IDS` and/or `OWNER_EMAILS` | Who gets the Owner role on sign-in. **Required on a fresh database.** |
| `AUTH_PROVIDERS` | `roblox`, `google`, `test`, comma-separated |

Generate the session secret with:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```
Install, check and start:
```bash
npm install
```
```bash
npm run check
```
```bash
npm start
```

### 4. Branding
Edit `studio.config.json`: name, logo, website, colours, sign-in text, features and payout
options. Restart the API to apply. See the reference below.

### 5. Website
Set `apiBase` in `config.js` to the API's URL. Stamp the asset versions, then publish
`index.html`, `config.js`, `favicon.svg`, `sw.js` and `assets/` to any static host (GitHub Pages,
Netlify, Cloudflare Pages...).
```bash
npm run stamp
```

### 6. First sign-in
Sign in with the Roblox account or Google email you put in `OWNER_ROBLOX_IDS` / `OWNER_EMAILS`.
You'll be the Owner. From there:
* **Settings > Sign-in**: add your Roblox group (and minimum rank) so staff can get in.
* **Settings > Roles**: link the starter roles to group ranks, or assign them to people.
* **Settings > Invites**: create invite links for people outside the group.

---

## Sign-in providers

| Provider | Who gets in |
| --- | --- |
| `roblox` | Members of your sign-in Roblox groups / Discord servers, anyone with a role, team or invite, and `OWNER_ROBLOX_IDS`. |
| `google` | Emails in `OWNER_EMAILS`, emails on `GOOGLE_ALLOWED_DOMAINS`, and anyone with a role, team or invite. |
| `test` | Anyone, as **Test Owner / Test Manager / Test Staff**, with onboarding already done. For demos and QA. |

A fresh install is **closed by default**: until you add a sign-in group, only owners and people
who were given a role, a team or an invite can get in.

**Test mode** puts three one-click buttons on the sign-in page. Use it to try every screen on a
fresh database, or to demo the panel to a buyer. It prints a warning when the API starts, and
`npm run check` flags it. Remove `test` from `AUTH_PROVIDERS` before real staff use the panel.
Existing test sessions stop working within ten minutes of turning it off.

---

## `studio.config.json` reference

```jsonc
{
  "studio":   { "name": "Acme", "shortName": "AC", "productName": "Panel", "website": "https://acme.gg",
                "websiteLabel": "acme.gg", "logoUrl": "assets/logo.svg", "requestIdPrefix": "AC",
                "contactEmail": "ops@acme.gg", "discordInviteUrl": "https://discord.gg/..." },
  "theme":    { "accent": "#5B5FEF", "accentDark": "#8C8FFF", "radius": 14, "defaultMode": "light" },
  "signIn":   { "title": "Sign in", "subtitle": "...", "buttonLabel": "Sign in with Roblox",
                "headline": "Paid for what you build.", "tagline": "...{studio}...", "backgroundImage": "",
                "footerNote": "...", "showPreview": true, "termsUrl": "#/tos", "privacyUrl": "#/aup" },
  "features": { "payments": true, "claims": true, "paymentRuns": true, "analytics": true, "teams": true,
                "recruitment": true, "staffDatabase": true, "security": true, "audit": true,
                "backups": true, "broadcasts": true, "discord": true, "pushNotifications": true },
  "payments": { "currencies": ["ROBUX", "USD"], "methods": ["PAYPAL", "DEVEX_ROBUX", "VENMO", "BANK_TRANSFER"] },
  "legal":    { "tos": "", "aup": "" },
  "moneyRules": { "allowSelfApproval": false, "maxAmount": { "ROBUX": 10000000, "USD": 100000 } }
}
```
* The name shown everywhere is `name` followed by `productName` (leave `productName` empty for just the name).
* `{studio}` in any text is replaced with the studio name.
* A switched-off feature disappears from the menu, can't be opened by URL, and the API refuses its actions.
* Empty `legal` texts fall back to built-in Terms and Acceptable Use Policy with your studio name filled in.
* Precedence: built-in defaults < `studio.config.json` < `STUDIO_*` environment variables.

---

## Security

* **Sessions**: random 256-bit tokens, stored only as SHA-256 hashes. Re-checked against group membership every 10 minutes.
* **No tokens in URLs**: wiped from the address bar right after sign-in. Discord linking uses a signed two-minute ticket.
* **Database closed**: RLS on every table, no grants to the public `anon` key. Only the API's service key gets in.
* **Separation of duties**: nobody can approve, re-price or pay out their own money, whatever their role.
* **No privilege escalation**: role managers can only grant permissions they hold, and only below their own rank.
* **Limits**: per-request money ceilings, per-IP and per-session rate limits, 1 MB bodies, JSON only, payload depth and prototype-pollution checks, 25-second timeouts on every outgoing call.
* **Clean errors**: database error text never reaches the browser.
* **Headers**: HSTS, nosniff, frame-deny, no-referrer and a locked CSP on the API; a strict CSP on the website.
* **Security levels**: *heightened* pauses all money movement; *lockdown* closes the panel to everyone except security managers. It raises itself automatically on bursts of payout-method changes.

## Performance

* One request (`/public/bootstrap`) paints the first screen, and the result is cached in the browser so repeat visits paint instantly.
* Sessions, roles and access rules are cached in the API, so most requests make no extra database round trips.
* Chart.js and ExcelJS load only on the screens that need them. CSS and JS are content-hashed and cached.
* Identical reads fired at the same moment share one network call.

## Scripts

| Command | What it does |
| --- | --- |
| `npm start` | API + Discord bot |
| `npm run start:api` / `start:bot` | Just one of them |
| `npm run check` | Validates environment variables, `studio.config.json` and `config.js` |
| `npm test` | Unit and end-to-end tests (in-memory fake database, no setup needed) |
| `npm run stamp` | Content-hashes asset URLs in `index.html` before publishing |

## Project layout

```
index.html            page shell
config.js             website deployment setting (apiBase)
favicon.svg           browser tab icon
assets/app.js         the web app
assets/app.css        component styles
assets/theme.css      design system, app shell, sign-in page
assets/boot.js        applies theme and cached branding before first paint
assets/logo.svg       default logo (swap for yours, or point studio.logoUrl at a URL)
server.js             API
bot.js                Discord bot (optional)
lib/                  security, studio config, cache
studio.config.json    this deployment's branding and options
sql/setup.sql         full database setup (drops and recreates)
sql/reset-data.sql    delete all data, keep tables
scripts/              config checker, asset stamper
test/                 tests
```
