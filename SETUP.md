# Setup guide

Everything you need to take this panel from a fresh copy to a live studio, and a list of
exactly what to change to make it yours. Plan on about 30 minutes the first time.

If you only read one part, read **[What to change](#what-to-change)** and the
**[go-live checklist](#go-live-checklist)**.

---

## Contents

1. [How it fits together](#how-it-fits-together)
2. [What you need](#what-you-need)
3. [Step 1: Database](#step-1-database)
4. [Step 2: Roblox sign-in](#step-2-roblox-sign-in)
5. [Step 3: The API](#step-3-the-api)
6. [Step 4: The website](#step-4-the-website)
7. [Step 5: First sign-in](#step-5-first-sign-in)
8. [Step 6: Make it yours (Branding)](#step-6-make-it-yours-branding)
9. [Step 7: Who can get in](#step-7-who-can-get-in)
10. [Step 8: Payments](#step-8-payments)
11. [What to change](#what-to-change)
12. [Go-live checklist](#go-live-checklist)
13. [Keeping it healthy](#keeping-it-healthy)
14. [Updating an existing install](#updating-an-existing-install)
15. [The Discord add-on](#the-discord-add-on)
16. [Demo mode](#demo-mode)
17. [Troubleshooting](#troubleshooting)

---

## How it fits together

There are three pieces, hosted separately:

| Piece | What it is | Where it runs |
| --- | --- | --- |
| **Website** | `index.html`, `config.js`, `favicon.svg`, `sw.js`, `assets/` | Any static host: GitHub Pages, Netlify, Cloudflare Pages, Vercel |
| **API** | `server.js` (Node 18+) | Any Node host: Render, Railway, Fly.io, a VPS |
| **Database** | Postgres on Supabase | supabase.com |

The browser only ever talks to the API. The database is locked so only the API can read it.

## What you need

- A **Supabase** account (the free tier is fine to start).
- A **Roblox** account that can create an OAuth app (for "Sign in with Roblox").
  Optional: a **Google Cloud** project if you also want "Continue with Google".
- A host for the **API** and a host for the **website**.
- Two web addresses, for example `panel.yourstudio.com` (website) and `api.yourstudio.com` (API).
  The free addresses your hosts give you work too.

---

## Step 1: Database

1. Create a project at [supabase.com](https://supabase.com).
2. Open **SQL editor → New query**, paste the whole of `sql/setup.sql`, and press **Run**.
3. The last result should list every table with `rls_enabled = true` and
   `anon_can_select = false`. That means the database is closed to the public.
4. Go to **Project Settings → API** and copy the **Project URL** and the **service_role** key.
   You'll need them in step 3. The service key is a secret: never put it in the website.

`sql/setup.sql` wipes and recreates every table, so only run it on a new database.

## Step 2: Roblox sign-in

1. Go to [create.roblox.com/credentials](https://create.roblox.com/credentials) and create an
   **OAuth 2.0 app**.
2. Scopes: `openid` and `profile`.
3. Redirect URL: `https://<your-api-address>/roblox-auth-callback`.
4. Copy the **client ID** and **client secret**.

**Google (optional).** In Google Cloud Console → APIs & Services → Credentials, create an
**OAuth client ID** of type *Web application* with the redirect URI
`https://<your-api-address>/google-auth-callback`.

## Step 3: The API

Set these environment variables on your API host (or copy `.env.example` to `.env` for local
use). The full list with explanations is in `.env.example`.

| Variable | Value |
| --- | --- |
| `APP_ORIGIN` | Your website address, e.g. `https://panel.yourstudio.com` (no slash at the end) |
| `SUPABASE_URL` | From step 1 |
| `SUPABASE_SERVICE_ROLE_KEY` | From step 1 |
| `ROBLOX_CLIENT_ID`, `ROBLOX_CLIENT_SECRET` | From step 2 |
| `ROBLOX_REDIRECT_URI` | `https://<your-api-address>/roblox-auth-callback` |
| `SESSION_SECRET` | A long random string (command below) |
| `OWNER_ROBLOX_IDS` | Your Roblox user id. Comma-separate several. This is how you get in the first time. |
| `OWNER_EMAILS` | Same, for Google sign-in |
| `AUTH_PROVIDERS` | `roblox`, or `roblox,google` |

Make a session secret:

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

`npm run check` tells you about anything missing or wrong before you start. On most hosts the
build command is `npm install` and the start command is `npm start`.

## Step 4: The website

1. Open `config.js` and set `apiBase` to your API's address, e.g. `https://api.yourstudio.com`.
2. If you use a custom domain on GitHub Pages, put it in the `CNAME` file (or delete the file
   if you don't use one).
3. Stamp the asset versions so browsers pick up new files after each update:

   ```bash
   npm run stamp
   ```

4. Upload `index.html`, `config.js`, `favicon.svg`, `sw.js`, `manifest.webmanifest`, `CNAME` (if
   used) and the `assets/` folder to your static host. Nothing else needs to be public.
   (`npm run stamp` also rebuilds `manifest.webmanifest` with your studio's name and colour, so
   people who install the panel as an app get your branding.)

## Step 5: First sign-in

Open the website and sign in with the Roblox account (or Google email) you put in
`OWNER_ROBLOX_IDS` / `OWNER_EMAILS`. You get the **Owner** role automatically.

The first time an Owner signs in, a **setup guide** opens. It takes about three minutes:

1. **Your studio**: name, logo and brand colour, with a live preview.
2. **Who can sign in**: your Roblox group and minimum rank.
3. **Payouts**: Robux and/or cash, which payout methods people can pick, and the DevEx rate.
4. **Invite your team**: creates your first invite link, ready to copy.

Every step can be skipped and changed later in Settings. To open the guide again, use
Settings → Health → *Open the setup guide*.

New people see a short welcome tour and accept the Terms of Service and Acceptable Use Policy
the first time they sign in.

## Step 6: Make it yours (Branding)

Go to **Settings → Branding**. Everything here is saved in the database and goes live for
everyone as soon as you press **Save changes**:

- **Studio**: name, optional product name (e.g. "Northwind" + "Hub"), initials, request ID
  prefix (e.g. `NW` makes request IDs like `NW_...`), contact email, website.
- **Logo & colours**: upload a logo (it's resized for you and also used as the browser tab icon),
  accent colours for light and dark mode, corner roundness, default theme.
- **Sign-in page**: title, text, button label, the headline and tagline on the right, a note at
  the bottom, an optional background image, and whether to show the product preview.
- **Features**: switch whole areas off (Analytics, Teams, Payment runs, Backups...). A feature
  that's off disappears from the menu, can't be opened by link, and the API refuses it.
- **Payouts**: which currencies (Robux, USD) and payout methods (PayPal, Robux, Venmo, bank
  transfer) your studio uses.
- **Legal pages**: your own Terms of Service, Privacy Policy and Acceptable Use Policy. Leave a
  page empty to use the built-in text. The live pages are at `#/terms`, `#/privacy` and `#/aup`
  and anyone can read them, signed in or not.

Only roles with the **Edit branding** permission can open this page (Owner and Admin by default).

> `studio.config.json` holds the *defaults* the panel starts with. Anything saved in
> Settings → Branding takes priority. **Reset all branding** at the bottom of the page goes back
> to the file.

## Step 7: Who can get in

A fresh install is **closed**: only owners and people you give a role, a team or an invite link
can sign in.

- **Settings → Sign-in**: add your Roblox group (and a minimum rank) so your staff get in
  automatically.
- **Settings → Roles**: five starter roles exist (Owner, Admin, Manager, Lead, Staff). Edit their
  permissions, link them to group ranks, or assign them to people.
- **Settings → Invites**: create a link for someone outside the group. It can put them on a team,
  give them a skill and a role in one go.
- **Settings → Teams & skills**: your teams, their Roblox groups and skillsets.

## Step 8: Payments

- **Settings → Games & DevEx**: add your games, set the DevEx rate and any minimum for USD payouts.
- **Settings → Rate card**: standard pay per kind of job, so the same work gets the same pay.
- Staff add their payout method under **My payments**.
- Work gets paid in three ways: someone **logs work** for a person, staff **request payment**
  for their own work, or a lead pays out a **task** from Teams. Every one of them is approved by
  someone else, never by the person being paid.
- **Payment runs** group approved work into a pay day: open a run, freeze it at the cut-off, pay
  the sheet, close it.

Money safety rails live in the environment, not the panel, so a compromised admin account can't
switch them off: `ALLOW_SELF_APPROVAL` (leave it off), `MAX_ROBUX_PER_REQUEST`,
`MAX_USD_PER_REQUEST`.

---

## What to change

Everything that makes this deployment "yours", and where it lives.

| What | Where | Notes |
| --- | --- | --- |
| API address | `config.js` → `apiBase` | The only website file you need to edit |
| Custom domain (GitHub Pages) | `CNAME` | Delete it if you don't use one |
| Studio name, logo, colours, sign-in page, legal text | **Settings → Branding** | Saved in the database. Live straight away. |
| Default branding for a fresh database | `studio.config.json` | Used until someone saves Branding |
| First-paint branding | `config.js` → `branding` | What a first-time visitor sees for the split second before the API answers. Keep it roughly in sync. |
| Default logo file | `assets/logo.svg`, `favicon.svg`, `assets/icon-192.png` | Replace with your own, or upload a logo in Branding |
| Who becomes Owner | `OWNER_ROBLOX_IDS`, `OWNER_EMAILS` (environment) | |
| Sign-in buttons | `AUTH_PROVIDERS` (environment) | `roblox`, `google`, `test` |
| Money limits | `MAX_ROBUX_PER_REQUEST`, `MAX_USD_PER_REQUEST` (environment) | |
| Add-ons | `ADDON_DISCORD` (environment) | See below |
| Page title before load | `index.html` → `<title>` | Replaced by your studio name once loaded |

**Copy you should read before going live:** the built-in Terms of Service, Privacy Policy and
Acceptable Use Policy are written for a typical studio staff tool. They are a starting point,
not legal advice. Read them in Settings → Branding → Legal pages, fill in your contact email
in Branding → Studio (it's used in the policies), and have your final text checked.

## Go-live checklist

- [ ] `npm run check` shows no problems.
- [ ] `AUTH_PROVIDERS` does **not** include `test`.
- [ ] `SESSION_SECRET` is set to a long random value.
- [ ] `OWNER_ROBLOX_IDS` / `OWNER_EMAILS` only contain people who should own the panel.
- [ ] `config.js` points at your API, and you ran `npm run stamp` before uploading.
- [ ] Settings → Branding: name, logo, colours and contact email are set.
- [ ] Settings → Branding → Legal pages: you've read the three policies.
- [ ] Settings → Sign-in: your Roblox group is added, or you've sent invite links.
- [ ] Settings → Roles: permissions are what you want (especially *Mark requests paid* and
      *View full bank transfer details*).
- [ ] You signed in as a normal staff account once and checked what they see.
- [ ] Settings → Health → *Send a test alert* reaches you (studio webhook, or `ALERT_WEBHOOK_URL`).
- [ ] The public status page (`/#/status`) loads.

---

## Keeping it healthy

Settings → **Health** is the operations page:

- **Errors**: anything that breaks on the server or in someone's browser is logged, grouped
  (one row per kind of error, with a count) and scrubbed of anything that looks like a token.
  Mark them fixed once handled; if one comes back it reopens.
- **Alerts**: a new error, or no backup for `BACKUP_STALE_HOURS` (default 14), sends an alert to
  `ALERT_WEBHOOK_URL` (a Discord or Slack incoming webhook, for whoever runs the deployment).
  Without it, alerts go to the studio webhook in Settings → Notifications when *Something
  breaks* is ticked.
- **Backups**: taken every 6 hours, kept for `BACKUP_RETENTION_DAYS` (default 30), and the newest
  `BACKUP_KEEP_MIN` (default 10) are always kept.

`/#/status` is a public status page (no sign-in needed) showing whether the panel, database and
backups are working, plus any message you set in `app_settings.status_message`. Share it with
your staff for "is it down or is it me?" moments.

The panel can be **installed as an app** on phones and desktops (browser menu → *Install* or
*Add to Home Screen*). Pages always load fresh from the server; with no connection people get
a clear offline screen instead of a browser error.

---

## Updating an existing install

1. Replace the code with the new version (keep your `config.js`, `CNAME`, `.env` and
   `studio.config.json`).
2. In the Supabase SQL editor, run **`sql/upgrade.sql`**. It's safe on a live database, can be
   run more than once, and never deletes anything. It adds the `branding` column and gives the
   Owner and Admin roles the new **Edit branding** permission.
3. Restart the API, run `npm run stamp`, and upload the website files.

### What people see during an update

The website and the API each know their release version (the `version` in `package.json`;
`npm run stamp` writes it into `index.html`). While they differ, for example when the website
has been published but the API is still deploying, or the API is an older build that doesn't
report a version at all, everyone sees a short **"Updating"** maintenance screen instead of a
half-working panel. The same screen says **"Finishing an update"** if the new API is live but
`sql/upgrade.sql` hasn't been run yet. It checks every 10 seconds and reloads by itself once
everything matches. People already signed in keep their session.

To ship your own change, bump the version so both sides move together:

```bash
npm run release
```

That bumps the patch version (use `npm run release -- minor` for bigger releases), rebuilds the
app manifest and re-stamps `index.html`. Then deploy the API and the website. `npm run check`
warns if the website and the API are stamped with different versions.

The first-run setup guide is stored in the database, so redeploying never brings it back. It
opens on its own at most once per owner, and never for a studio that already has people paid,
roles handed out or a sign-in group. Reopen it any time from Settings → Health.

Other SQL files:

| File | What it does |
| --- | --- |
| `sql/setup.sql` | Fresh install. **Drops and recreates every table.** |
| `sql/upgrade.sql` | Brings an existing database up to date. Safe. |
| `sql/reset-data.sql` | Deletes all data but keeps the tables and your branding. Re-seeds the roles. |
| `sql/clear-discord.sql` | Optional. Wipes every Discord id an older version stored (role, server and channel ids). Doesn't touch payments, people or roles. |

---

## The Discord add-on

Discord is sold separately and is **off** unless the deployment turns it on. It includes:

- Linking staff Discord accounts, and DMs about payments and moderation
- Signing in by Discord server membership
- Discord roles given and taken away with panel roles
- The Discord bot (`bot.js`)
- **Recruitment**: public applications, Discord ticket channels, hiring phases and analytics

While it's off, none of this appears anywhere in the panel, the API refuses its routes and
actions, Discord ids in the database are ignored, Discord fields are dropped from saves, and the
bot doesn't start. Nobody is ever asked to link Discord.

**To switch it on** for a customer who bought it: set `ADDON_DISCORD=true` and fill in the
`DISCORD_*` variables in the environment (see `.env.example`), then restart. `npm start` also
starts the bot when the add-on is on. Add-ons can't be switched on from inside the panel.

---

## Demo mode

Add `test` to `AUTH_PROVIDERS` (e.g. `roblox,test`) and the sign-in page shows one-click
**Owner / Manager / Staff** test accounts. Use it to try every screen on an empty database or to
demo the panel to a buyer. The API prints a warning while it's on and `npm run check` flags it.
Remove `test` before real people use the panel; test sessions stop working within ten minutes.

---

## Troubleshooting

**"Couldn't reach the server" on the sign-in page.**
`config.js` → `apiBase` is wrong, the API isn't running, or `APP_ORIGIN` on the API doesn't match
the website's address exactly (scheme included, no trailing slash).

**"This account doesn't have access yet."**
Nobody gave this person a way in. Add your Roblox group in Settings → Sign-in, give them a role,
or send an invite link. On a fresh database, make sure your own id is in `OWNER_ROBLOX_IDS`.

**Branding won't save: "Your database needs a quick update first".**
Run `sql/upgrade.sql` in the Supabase SQL editor.

**I don't see Settings → Branding.**
Your role needs the *Edit branding* permission. Run `sql/upgrade.sql` on an older database, or
add the permission to your role in Settings → Roles.

**Old styles or scripts after an update.**
Run `npm run stamp` before uploading the website, so browsers fetch the new files.

**Download .xlsx does nothing / charts don't show.**
These load a library from `cdn.jsdelivr.net` on demand. Make sure that address isn't blocked
on the network.

**Commands**

| Command | What it does |
| --- | --- |
| `npm start` | API, plus the Discord bot if the add-on is on |
| `npm run start:api` | Just the API |
| `npm run check` | Checks the environment, `studio.config.json` and `config.js` |
| `npm test` | Runs the tests (no database needed) |
| `npm run stamp` | Content-hashes asset URLs in `index.html` before you upload |
