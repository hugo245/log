# Studio Panel

A white-label staff panel for Roblox studios. Staff sign in, log their work, get it approved and
see every payout in one place. Leads run teams, games and deadlines, and owners get payments,
analytics, an audit log and a security centre.

Each deployment gets its own name, logo, colours, sign-in page, legal pages, payout options and
feature set, edited from **Settings → Branding** inside the panel.

**Setting it up? Start with [SETUP.md](SETUP.md).** It covers installation, what to change,
a go-live checklist and troubleshooting.

---

## Features

| Area | What it does |
| --- | --- |
| **Sign-in** | Roblox, Google, or demo mode. Access by Roblox group rank, manual role, team or invite link. Owners are set from the environment. |
| **Payments** | Log work for someone, staff payment requests, approvals, payment runs, PayPal / Venmo / bank / Robux payouts, DevEx conversion, payout splits, Excel export. |
| **Teams & games** | Teams, skills, game stats from Roblox, task boards, deadlines, reviews, reminders. |
| **Staff** | Staff database, warnings, bans, payout holds, onboarding with Terms / Acceptable Use. |
| **Admin** | Branding, roles and permissions with hierarchy, audit log with revert, backups, announcements, security levels, session management. |
| **Operations** | First-run setup guide, error log with alerts, backup retention, public status page, installable app with an offline screen. |
| **Legal** | Public Terms of Service, Privacy Policy and Acceptable Use pages, with built-in text you can replace. |

### Add-ons

| Add-on | Switch | Includes |
| --- | --- | --- |
| **Discord** | `ADDON_DISCORD=true` | Discord account linking and DMs, sign-in by Discord server, Discord role sync, the Discord bot, and Recruitment (applications, ticket channels, hiring phases, analytics). |

Add-ons are off by default. While one is off it's completely hidden: no menu items, no settings,
the API refuses its routes, and its stored ids are ignored. See [SETUP.md](SETUP.md#the-discord-add-on).

## How it fits together

```
 Browser (static site)          API (Node / Express)                Supabase (Postgres)
 index.html + assets/  ─HTTPS─▶ server.js            ─service key─▶ tables: RLS on,
 config.js (apiBase)            lib/                                 no public access
                                bot.js (Discord add-on only)
```

The browser never talks to the database. Every action goes through the API, which checks the
session, the permission and the studio's money rules each time.

## Branding

Branding is layered, later wins:

1. Built-in defaults (`lib/studio.js`)
2. `studio.config.json` (defaults for this deployment)
3. `STUDIO_*` environment variables
4. **Settings → Branding**, saved in the database (`app_settings.branding`)

Everything saved from the panel goes through the same validator as the file: plain text only,
hex colours, `https://` links or uploaded raster images (PNG, JPEG, WebP, GIF, resized in the
browser and capped at 300 KB). Add-on features can't be switched on from branding, and money
rules can't be changed there at all.

`{studio}` in any text is replaced with the studio name; `{contact}` in legal text with the
contact email.

## `studio.config.json` reference

```jsonc
{
  "studio":   { "name": "Acme", "shortName": "AC", "productName": "Panel", "website": "https://acme.gg",
                "websiteLabel": "acme.gg", "logoUrl": "assets/logo.svg", "requestIdPrefix": "AC",
                "contactEmail": "ops@acme.gg" },
  "theme":    { "accent": "#5B5FEF", "accentDark": "#8C8FFF", "radius": 14, "defaultMode": "light" },
  "signIn":   { "title": "Sign in", "subtitle": "...", "buttonLabel": "Sign in with Roblox",
                "headline": "Paid for what you build.", "tagline": "...{studio}...", "backgroundImage": "",
                "footerNote": "...", "showPreview": true },
  "features": { "payments": true, "claims": true, "paymentRuns": true, "analytics": true, "teams": true,
                "staffDatabase": true, "security": true, "audit": true, "backups": true,
                "broadcasts": true, "pushNotifications": true },
  "payments": { "currencies": ["ROBUX", "USD"], "methods": ["PAYPAL", "DEVEX_ROBUX", "VENMO", "BANK_TRANSFER"] },
  "legal":    { "tos": "", "privacy": "", "aup": "" },
  "addons":   { "discord": false },
  "moneyRules": { "allowSelfApproval": false, "maxAmount": { "ROBUX": 10000000, "USD": 100000 } }
}
```

* Empty `legal` texts use the built-in policies (`lib/legal.js`) with your studio name filled in.
* `addons` can also be set with `ADDON_*` environment variables, which take priority.
* `moneyRules` can only be set here or in the environment, never from the panel.

## Security

* **Sessions**: random 256-bit tokens, stored only as SHA-256 hashes. Re-checked against group membership every 10 minutes.
* **No tokens in URLs**: wiped from the address bar right after sign-in.
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

## Scripts

| Command | What it does |
| --- | --- |
| `npm start` | API, plus the Discord bot when the Discord add-on is on |
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
assets/theme.css      design system, app shell, sign-in, legal and branding pages
assets/boot.js        applies theme and cached branding before first paint
assets/logo.svg       default logo
server.js             API
bot.js                Discord bot (Discord add-on)
lib/studio.js         branding, features and add-ons
lib/legal.js          built-in Terms, Privacy Policy and Acceptable Use text
lib/security.js       sessions, tickets, rate limits, headers
lib/cache.js          small TTL cache
studio.config.json    this deployment's default branding and options
sql/setup.sql         full database setup (drops and recreates)
sql/upgrade.sql       bring an existing database up to date (safe)
sql/reset-data.sql    delete all data, keep tables and branding
sql/clear-discord.sql optional: wipe stored Discord ids
scripts/              start, config checker, asset stamper
test/                 tests
SETUP.md              owner's setup guide
```
