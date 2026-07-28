# Climate Designers Event Tracker

A dashboard that pulls upcoming and past events from every Climate Designers chapter's public calendar into one place, so the internal team (including Marc) can see all chapters' events without checking each one by hand.

## Why this exists

The North American Regional Lead previously checked each chapter's Luma/Peatix page weekly and copied new events into an internal Notion database by hand. This project automates that: a scraper pulls events from each chapter's calendar on a schedule, a static dashboard displays them, and (optionally) new future events are created in a Notion tracker.

## How it works

1. **`data/chapters.json`** — one entry per chapter: name, region, and either a `luma` source with a resolved `calendarApiId` (plus optional `approvedHosts` for host filtering), or a `manual` source with a `reason` the chapter isn't auto-scraped yet.
2. **`scripts/scrape.js`** — plain Node script (no dependencies). For each `luma` chapter, calls Luma's public JSON API (`https://api.lu.ma/calendar/get-items?calendar_api_id=<id>&period=future|past`), merges and dedupes events, geocodes each event's address via OpenStreetMap's free Nominatim API (caching results in `data/geocache.json` so repeat runs don't re-hit it), and writes the result to `data/events.json`. Host filter is **on by default**: keep an event if **any** Luma host matches that chapter's `approvedHosts` (co-hosted partner events still pass). `HOST_FILTER=review` logs kept/skipped without changing output; `HOST_FILTER=off` includes every calendar event.
3. **`scripts/sync-notion.js`** — create-only sync of **new future** events from `data/events.json` into Notion (dedupe by Event URL). Fills name, date, chapter, format, location, URL, and quarter; leaves **Category** and **Place** blank for humans.
4. **`.github/workflows/update-events.yml`** — GitHub Actions job, scheduled daily (`0 13 * * *` UTC), that runs the scraper, syncs new events to Notion, then commits `data/events.json` / `data/geocache.json` if they changed. Also runnable manually from the Actions tab (`workflow_dispatch`).
5. **`index.html` / `style.css` / `app.js`** — static frontend that fetches `data/events.json` client-side and renders a table view, a calendar view, a map view (Leaflet + OpenStreetMap tiles), and a "needs setup" section for chapters that aren't auto-scraped.

No build step, no backend server — everything is static files plus a scheduled script.

### Resolving a new chapter's `calendarApiId`

Luma calendar pages embed a `__NEXT_DATA__` script tag containing `props.pageProps.initialData.data.calendar.api_id`. Fetch the chapter's Luma page HTML once, pull that ID out, and add it to `data/chapters.json` — after that, `scrape.js` only ever calls the stable JSON API, never re-parses HTML.

## Running locally

```bash
node scripts/scrape.js   # regenerates data/events.json (host filter on)
HOST_FILTER=review node scripts/scrape.js   # log keep/skip decisions (still writes all events)
HOST_FILTER=off node scripts/scrape.js      # include every calendar event
python3 -m http.server 8934   # or any static file server
```

Then open `http://localhost:8934/`.

### Notion sync

Always scrape **before** syncing so Notion sees the latest Luma data:

```bash
node scripts/scrape.js

# Practice mode — prints what it would create, writes nothing
DRY_RUN=1 NOTION_TOKEN=ntn_... node scripts/sync-notion.js

# Live create (local default LIMIT=15; set LIMIT=0 for no cap)
NOTION_TOKEN=ntn_... node scripts/sync-notion.js
```

Optional: `NOTION_DATABASE_ID=...` (defaults to the Event Tracker Test database). The Notion integration must be connected to that database. Do not commit the token.

### GitHub Actions secrets (daily Notion sync)

Repo → **Settings → Secrets and variables → Actions**:

| Secret | Required | Purpose |
|---|---|---|
| `NOTION_TOKEN` | Yes | Notion integration token (`ntn_...`) |
| `NOTION_DATABASE_ID` | No | Target database ID (defaults to Event Tracker Test in the script) |

After secrets are set, push the workflow + `scripts/sync-notion.js`, then use **Actions → Update events → Run workflow** to test. The scheduled job runs scrape → Notion sync (`LIMIT=0`) → commit.

To point at the real Climate Designers tracker later: change `NOTION_DATABASE_ID` (and use an integration shared on that DB). No code change required.

## Current status (as of 2026-07-28)

- **Backend (scraper + data + GitHub scrape job): done.** Host filtering on; Toronto and Dubai on Luma scrape list.
- **Notion sync: done for Event Tracker Test** (create-only; Category/Place still manual). Daily Actions sync once `NOTION_TOKEN` is set and this branch is pushed.
- **Frontend: in progress, styled to match the real Climate Designers brand** (colors/fonts pulled from https://www.climatedesigners.org/styleguide — Archivo Black headings, dark header, bright accent palette). The user is iterating on `style.css`/`index.html` directly in Chrome DevTools (open via `http://localhost:8934/`, not the `index.html` file directly — `fetch()` doesn't work under the `file://` protocol) and may still bring in a Figma design on top of this. Small pending polish items get fixed as they're noticed (e.g. region-tag pill sizing, filter alignment).
- **Hosting: not yet set up.** Repo is private, so plan is Vercel (supports private repos free), not GitHub Pages (requires a public repo). Needs a Vercel account created by the user, then the repo connected for auto-deploy.

## Dashboard vs Notion

Both paths are in play:

- **Notion** (automated into Event Tracker Test for now): keeps the internal team's familiar tracker updated; visibility stays limited to the workspace. Category and Place still need a human.
- **Dashboard**: can go public / embed on Squarespace later for wider visibility.

Promoting Notion sync from Test → the real CD Event Tracker is a config change (secret + integration share), not a rewrite.

## Chapters not yet auto-scraped

See the `manual`-source entries in `data/chapters.json` for current reasons (Japan/Peatix, Philippines, Singapore, Milan, etc.). These show up in the dashboard's "Needs setup" section instead of being silently omitted.
