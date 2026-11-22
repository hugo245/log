# Studio Hub

A white-label staff hub for Roblox studios. Staff sign in with Roblox, log their work, get it
approved and see every payout in one place. Leads run teams, games and deadlines, HR runs
recruitment, and leadership gets payments, analytics, an audit log and a security centre.

Every studio gets its own name, logo, colours, sign-in page, payout options and feature set,
all from one config file or the **Settings > Branding** panel. No code changes needed.

---

## What's inside

| Area | What it does |
| --- | --- |
| **Sign-in** | Roblox OAuth (PKCE). Access through Roblox group ranks, manual roles or invite links. Optional Discord server requirement. |
| **Payments** | Log work for someone, staff payment requests, approvals, payment runs, PayPal / Venmo / bank / Robux payouts, DevEx conversion, Excel export. |
| **Teams & games** | Teams, skillsets, game stats from Roblox, task boards, deadlines, reviews, reminders. |
| **Recruitment** | Applications, Discord ticket channels, phases, sign-off, auto-hire, analytics. |
| **People** | Staff database, warnings, bans, account holds, onboarding with Terms / AUP. |
| **Admin** | Roles and permissions with hierarchy, audit log with revert, backups, broadcasts, security protocol levels, session management. |
| **Branding** | Name, logo, colours, corner radius, light/dark default, sign-in copy and background, feature switches, currencies, payout methods, legal text. |

## How it fits together

```
 Browser (static site)            API (Node / Express)               Supabase (Postgres)
 index.html + assets/  ──HTTPS──▶  server.js                ──service──▶  tables (RLS on,
 config.js (apiBase)              lib/security.js  lib/studio.js       role key        no public access)
                                  bot.js (Discord, optional)
```

* The browser **never** talks to the database. Everything goes through the API, which checks
  the session, the permission and the studio's rules on every action.
* The static site can be hosted anywhere (GitHub Pages, Netlify, Cloudflare Pages, S3).
  The API runs on any Node 18+ host (Render, Railway, Fly, a VPS).

---

## Set it up for a new studio

### 1. Database
Create a Supabase project, create the schema, then run these in the SQL editor in order:

1. `sql/001_security_lockdown.sql`: turns on row-level security and removes all public access. Its last query lists every table; all should show `rls_enabled = true` and `anon_can_select = false`.
2. `sql/002_branding.sql`: lets the Branding panel save.
3. `sql/003_indexes.sql`: indexes for the hot paths. Columns your schema doesn't have are skipped.

### 2. Roblox app
At [create.roblox.com/credentials](https://create.roblox.com/credentials), create an OAuth 2.0 app with
scopes `openid profile`. Set the redirect URL to `https://<your-api>/roblox-auth-callback`.

### 3. API
```bash
cp .env.example .env
```
Fill in `.env` (or set the variables on your host). Generate the session secret with:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```
Then check and start:
```bash
npm install
```
```bash
npm run check
```
```bash
npm start
```
`npm start` runs the API and the Discord bot. Use `npm run start:api` to run only the API.

### 4. Branding
Edit `studio.config.json`: name, logo, website, colours, sign-in text, features and payout
options. Everything in it can be changed later from **Settings > Branding** by anyone whose
role has the *Manage branding* permission.

### 5. Website
Set `apiBase` in `config.js` to your API's URL. Then stamp the asset versions and publish the
folder:
```bash
npm run stamp
```
Publish `index.html`, `config.js`, `favicon.ico`, `sw.js` and `assets/`. Set `APP_ORIGIN` on the
API to the site's URL (no trailing slash).

---

## Configuration reference

### `studio.config.json` (server)
```jsonc
{
  "studio":   { "name": "Acme", "shortName": "AC", "productName": "Hub", "website": "https://acme.gg",
                "websiteLabel": "acme.gg", "logoUrl": "assets/logo.png", "requestIdPrefix": "AC",
                "contactEmail": "ops@acme.gg", "discordInviteUrl": "https://discord.gg/..." },
  "theme":    { "accent": "#6366F1", "accentDark": "#8B87FF", "radius": 18, "defaultMode": "light" },
  "signIn":   { "title": "Sign in", "subtitle": "...{studio}...", "buttonLabel": "Sign in with Roblox",
                "headline": "Paid for what you build.", "tagline": "...", "backgroundImage": "",
                "footerNote": "...", "showPreview": true, "termsUrl": "#/tos", "privacyUrl": "#/aup" },
  "features": { "payments": true, "claims": true, "paymentRuns": true, "analytics": true, "teams": true,
                "recruitment": true, "staffDatabase": true, "security": true, "audit": true,
                "backups": true, "broadcasts": true, "discord": true, "pushNotifications": true },
  "payments": { "currencies": ["ROBUX", "USD"], "methods": ["PAYPAL", "DEVEX_ROBUX", "VENMO", "BANK_TRANSFER"] },
  "legal":    { "tos": "", "aup": "" },

  // Server-only, never sent to browsers and not editable from the admin panel:
  "discord":    { "leadRoleId": "", "ticketCategoryId": "" },
  "moneyRules": { "allowSelfApproval": false, "maxAmount": { "ROBUX": 10000000, "USD": 100000 } }
}
```
* `{studio}` in any text is replaced with the studio name.
* A switched-off feature disappears from the menu, can't be opened by URL, and its API actions are refused.
* Order of precedence: built-in defaults < `studio.config.json` < environment variables < Branding panel.

### `config.js` (website)
Only `apiBase` is required. `branding` is used for the very first paint on a visitor's first
visit. After that the live branding is cached in the browser.

### Environment variables
See `.env.example`. Every variable is documented there.

---

## Security model

* **Sessions**: random 256-bit tokens, stored only as SHA-256 hashes. A database leak or an admin
  listing sessions can't be turned into a login. Sessions slide for 7 days and are re-checked
  against Roblox group membership every 10 minutes.
* **No tokens in URLs**: after sign-in the token is wiped from the address bar and history straight
  away. Discord linking uses a signed two-minute ticket instead of the session.
* **Database closed to the public**: RLS on every table, no anon grants; only the API's service key
  can read or write.
* **Separation of duties**: nobody can approve, re-price or pay out their own money, whatever their
  role. Attempts are logged as security events.
* **No privilege escalation**: role managers can only grant permissions they hold, and only change
  roles below their own hierarchy.
* **Amount limits**: per-request ceilings for Robux and USD.
* **Abuse limits**: per-IP and per-session rate limits, a stricter limit on money actions, 1 MB body
  limit, JSON-only endpoints, prototype-pollution and depth checks on every payload.
* **Clean errors**: database error text is never sent to browsers; it is logged server-side.
* **Headers**: HSTS, nosniff, frame-deny, no-referrer and a locked-down CSP on the API. The website
  ships a CSP that only allows scripts from itself and jsDelivr.
* **Branding input is sanitized**: colours, URLs and text are validated so an admin account can't use
  branding to inject script or CSS. Team colours are validated too.
* **Security protocol**: *heightened* pauses all money movement; *lockdown* closes the hub to everyone
  except security managers. It raises itself automatically on bursts of payout-method changes.

## Performance

* One request (`/public/bootstrap`) paints the first screen: branding, site status, games and the
  DevEx rate. It is cached in the browser, so repeat visits paint instantly.
* Signing in, site status and the session check run in parallel at boot.
* Sessions, roles and access rules are cached in the API with request coalescing. Typical requests
  make no extra database round trips, and Roblox re-syncs happen in the background.
* Chart.js and ExcelJS load only when a screen needs them. Supabase's browser SDK is gone entirely.
* CSS and JS are separate, content-hashed files (`npm run stamp`), so browsers cache them between
  visits. API responses are gzip-compressed.
* Identical reads fired at the same moment share a single network call.

## Scripts

| Command | What it does |
| --- | --- |
| `npm start` | API + Discord bot |
| `npm run start:api` / `start:bot` | Just one of them |
| `npm run check` | Validates env vars, `studio.config.json` and `config.js` |
| `npm test` | Unit and end-to-end tests (uses an in-memory fake database) |
| `npm run stamp` | Content-hashes asset URLs in `index.html` before publishing |

## Project layout

```
index.html            page shell (tiny)
config.js             website deployment settings (apiBase)
assets/app.js         the web app
assets/app.css        component styles
assets/theme.css      design system: tokens, sign-in page, Branding panel
assets/boot.js        applies theme + cached branding before first paint
assets/logo.png       default logo
server.js             API
bot.js                Discord bot (optional)
lib/security.js       token hashing, signed tickets, headers, rate limits, input guards
lib/studio.js         studio config loading, validation, public config
lib/cache.js          TTL cache with request coalescing
studio.config.json    this deployment's branding and options
sql/                  database lockdown, branding column, indexes
scripts/              config checker, asset stamper
test/                 node:test suites
```

## Upgrading an existing deployment to this version

1. Run the three SQL files.
2. Set `SESSION_SECRET` on the API host.
3. Make sure the host runs `npm install` on deploy. `node_modules` is no longer committed, and
   `compression` is a new dependency.
4. Deploy the API and the website together. Existing sign-ins carry over: old sessions are converted
   to hashed ones the first time they are used.
5. Give your owner role the new **Manage branding** permission.
