# Climate Designers Event Tracker

Pulls upcoming and past events from every Climate Designers chapter's public Luma calendar into one place — for the internal team (Notion) and a public list site.

**Live public site:** [https://boffdub.github.io/climate-designers-event-tracker/](https://boffdub.github.io/climate-designers-event-tracker/) (served from the `public-site` branch)

## Why this exists

The North American Regional Lead previously checked each chapter's Luma/Peatix page weekly and copied new events into an internal Notion database by hand. This project automates that: a scraper pulls events from each chapter's calendar on a schedule, a static site displays them, and new future events are created in a Notion tracker.

## Branches

| Branch | Role |
|---|---|
| **`main`** | Scraper, Notion sync, and the workflow definition the daily Action runs from. Keeps a mirrored copy of `data/events.json` for local/Notion work. |
| **`public-site`** | Public GitHub Pages UI (list view with chapter-gradient cards, Luma cover images, Upcoming/Past accordion). Calendar/Map are deferred here. |

## How it works

1. **`data/chapters.json`** — one entry per chapter: name, region, and either a `luma` source with a resolved `calendarApiId` (plus optional `approvedHosts` for host filtering), or a `manual` source with a `reason` the chapter isn't auto-scraped yet.
2. **`scripts/scrape.js`** — plain Node script (no dependencies). For each `luma` chapter, calls Luma's public JSON API (`https://api.lu.ma/calendar/get-items?calendar_api_id=<id>&period=future|past`), merges and dedupes events, stores each event's Luma **`coverUrl`**, geocodes addresses via OpenStreetMap Nominatim (caching in `data/geocache.json`), and writes `data/events.json`. Host filter is **on by default**: keep an event if **any** Luma host matches that chapter's `approvedHosts` (co-hosted partner events still pass). `HOST_FILTER=review` logs kept/skipped without changing output; `HOST_FILTER=off` includes every calendar event.
3. **`scripts/sync-notion.js`** — create-only sync of **new future** events from `data/events.json` into Notion (dedupe by Event URL). Fills name, date, chapter, format, location, URL, and quarter; leaves **Category** and **Place** blank for humans.
4. **`.github/workflows/update-events.yml`** — daily job (`0 13 * * *` UTC ≈ **9:00 AM Eastern** during daylight saving). Checks out **`public-site`**, scrapes, syncs Notion, commits data there (so Pages stays fresh), then mirrors `data/events.json` / `data/geocache.json` onto **`main`**. Also runnable from the Actions tab (`workflow_dispatch`).
5. **`index.html` / `style.css` / `app.js`** (on `public-site`) — static frontend that fetches `data/events.json` and renders a list of event cards (chapter gradients, cover thumbnails, region/chapter filters, chevron accordion for Upcoming/Past). Cards link out to Luma.

No build step, no backend server — everything is static files plus a scheduled script.

### Resolving a new chapter's `calendarApiId`

Luma calendar pages embed a `__NEXT_DATA__` script tag containing `props.pageProps.initialData.data.calendar.api_id`. Fetch the chapter's Luma page HTML once, pull that ID out, and add it to `data/chapters.json` — after that, `scrape.js` only ever calls the stable JSON API, never re-parses HTML.

## Running locally

Use the `public-site` branch to work on the public UI:

```bash
git checkout public-site
node scripts/scrape.js   # regenerates data/events.json (host filter on)
HOST_FILTER=review node scripts/scrape.js   # log keep/skip decisions (still writes all events)
HOST_FILTER=off node scripts/scrape.js      # include every calendar event
python3 -m http.server 8934   # or any static file server
```

Then open `http://localhost:8934/` (not the `index.html` file directly — `fetch()` doesn't work under `file://`). Hard-refresh (`Cmd+Shift+R`) after CSS/asset changes so the browser doesn't keep a stale stylesheet.

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

After secrets are set, use **Actions → Update events → Run workflow** to test. The scheduled job runs scrape → Notion sync (`LIMIT=0`) → commit to `public-site` → mirror data to `main`.

To point at the real Climate Designers tracker later: change `NOTION_DATABASE_ID` (and use an integration shared on that DB). No code change required.

## Current status (as of 2026-08-21)

- **Backend (scraper + data + GitHub scrape job): done.** Host filtering on; Luma cover URLs stored as `coverUrl`.
- **Notion sync: done for Event Tracker Test** (create-only; Category/Place still manual). Daily Actions sync with `NOTION_TOKEN` set.
- **Public site: live on GitHub Pages** from `public-site` — list UI with chapter gradients, cover images, filters, and accordion sections. Calendar/Map not on this branch yet.
- **Daily refresh:** Action updates `public-site` (Pages) and mirrors event data to `main` (~9 AM ET during EDT).

## Dashboard vs Notion

Both paths are in play:

- **Notion** (automated into Event Tracker Test for now): keeps the internal team's familiar tracker updated; visibility stays limited to the workspace. Category and Place still need a human.
- **Public site** (GitHub Pages): wider visibility for chapter events; cards open the Luma page.

Promoting Notion sync from Test → the real CD Event Tracker is a config change (secret + integration share), not a rewrite.

## Chapters not yet auto-scraped

See the `manual`-source entries in `data/chapters.json` for current reasons (Japan/Peatix, Philippines, Singapore, Milan, etc.).
