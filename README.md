# Climate Designers Event Tracker

Pulls upcoming and past events from every Climate Designers chapter's public event page (Luma, plus Humanitix for Milan and Peatix for Japan) into one place — for the internal team (Notion) and a public list site.

**Live public site:** [https://boffdub.github.io/climate-designers-event-tracker/](https://boffdub.github.io/climate-designers-event-tracker/) (served from the `public-site` branch)

## Why this exists

The North American Regional Lead previously checked each chapter's Luma/Peatix page weekly and copied new events into an internal Notion database by hand. This project automates that: a scraper pulls events from each chapter's calendar on a schedule, a static site displays them, and new future events are created in a Notion tracker.

## Branches

| Branch | Role |
|---|---|
| **`main`** | Scraper, Notion sync, and the workflow definition the daily Action runs from. Keeps a mirrored copy of `data/events.json` for local/Notion work. |
| **`public-site`** | Public GitHub Pages UI (list view with chapter-gradient cards, Luma cover images, Upcoming/Past accordion). Calendar/Map are deferred here. |

## How it works

1. **`data/chapters.json`** — one entry per chapter: name, region, and a `source`:
   - `luma`: a resolved `calendarApiId` (plus optional `approvedHosts` for host filtering)
   - `humanitix`: `humanitixHost` (the slug in `events.humanitix.com/host/<slug>`) and a `timezone` (Humanitix's structured data has no timezone name)
   - `peatix`: `peatixGroupId` (the number in `peatix.com/group/<id>`)
   - `manual`: a `reason` the chapter isn't auto-scraped yet
2. **`scripts/scrape.js`** — plain Node script (no dependencies). For each `luma` chapter, calls Luma's public JSON API (`https://api.lu.ma/calendar/get-items?calendar_api_id=<id>&period=future|past`), merges and dedupes events, stores each event's Luma **`coverUrl`**, geocodes addresses via OpenStreetMap Nominatim (caching in `data/geocache.json`), and writes `data/events.json`. Host filter is **on by default**: keep an event if **any** Luma host matches that chapter's `approvedHosts` (co-hosted partner events still pass). `HOST_FILTER=review` logs kept/skipped without changing output; `HOST_FILTER=off` includes every calendar event. The global "Climate Designers" account doesn't count as a chapter host on its own (its org-wide events get added to chapter calendars), and a chapter's optional `alwaysIncludeEvents` list of Luma URLs keeps one-off exceptions.
   - **Humanitix** chapters: reads the event list (slugs and coordinates) embedded in the host page, then each event page's schema.org JSON-LD block for the details.
   - **Peatix** chapters: calls Peatix's undocumented API, which its own site uses (`https://peatix-api.com/v4/groups/<id>/upcoming-events` and `/past-events`, `?limit=200`, no login). It has no paging, so the scraper warns if a list hits the limit.
   - Humanitix and Peatix pages belong to the chapter itself, so there's no host filter: every event is kept. Both platforms provide venue coordinates, so those events skip Nominatim.
3. **`scripts/sync-notion.js`** — create-only sync of **new future** events from `data/events.json` into Notion (dedupe by Event URL). Fills name, date, chapter, format, location, URL, and quarter; leaves **Category** and **Place** blank for humans.
4. **`.github/workflows/update-events.yml`** — daily job scheduled for `0 13 * * *` UTC (9:00 AM Eastern during daylight saving). GitHub delays scheduled jobs when it's busy, so in practice runs have started between about 1 and 5 PM Eastern. Checks out **`public-site`**, scrapes, syncs Notion, commits data there (so Pages stays fresh), then mirrors `data/events.json` / `data/geocache.json` onto **`main`**. Also runnable from the Actions tab (`workflow_dispatch`).
5. **`index.html` / `style.css` / `app.js`** (on `public-site`) — static frontend that fetches `data/events.json` and renders a list of event cards (chapter gradients, cover thumbnails, region/chapter filters, chevron accordion for Upcoming/Past). Cards link out to the event's own page (Luma, Humanitix, or Peatix).

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

Always scrape **before** syncing so Notion sees the latest event data:

```bash
node scripts/scrape.js

# Load the token into this terminal tab without saving it to shell history
read -s "NOTION_TOKEN?Paste Notion key, then Enter: " && export NOTION_TOKEN

# Practice mode — prints what it would create, writes nothing
DRY_RUN=1 NOTION_DATABASE_ID=<id> node scripts/sync-notion.js

# Live create (local default LIMIT=15; set LIMIT=0 for no cap; LIMIT=1 for a one-row test)
NOTION_DATABASE_ID=<id> node scripts/sync-notion.js
```

Notion databases:

| Database | Workspace | ID | Use |
|---|---|---|---|
| **Event Tracking (automated)** | Climate Designers (CD Management Home → Chapter Management) | `408498810e4180ad90bfcdfb254ac159` | Production — the daily Action writes here |
| **Event Tracker Test** | Brett's personal | `3a30471deb0980bf975df71e7ede0c23` | Sandbox for trying changes; the script falls back to it if `NOTION_DATABASE_ID` is unset |

Each workspace needs its own integration token, connected to the database (**⋯ → Connections**). The Climate Designers integration was created by a workspace owner with only **Read content + Insert content**, so it can add rows but never edit or delete them. Do not commit tokens. When copying a token from a chat app, watch for invisible extra characters: `echo ${#NOTION_TOKEN}` should print 50.

### GitHub Actions secrets (daily Notion sync)

Repo → **Settings → Secrets and variables → Actions**:

| Secret | Required | Purpose |
|---|---|---|
| `NOTION_TOKEN` | Yes | Climate Designers integration token (`ntn_...`) |
| `NOTION_DATABASE_ID` | Yes | `408498810e4180ad90bfcdfb254ac159` (Event Tracking (automated)) |

### Backfilling past events (new chapters)

The daily sync only adds **upcoming** events. When a chapter is first scraped, its past events can be added once with **Actions → Backfill Notion (manual) → Run workflow** (`.github/workflows/backfill-notion.yml`). It uses the same secrets, so nobody needs a local copy of the token. Inputs: chapters (e.g. `Japan,Milan`), a start date, a dry-run checkbox, and a row limit. Run it three times: dry run (check the log's "Would create" lines), then unticked with limit `1` (check the row in Notion), then limit `0`. It reads the `data/events.json` already on `public-site` and doesn't scrape or commit. Locally, the same thing is `BACKFILL_CHAPTERS=… BACKFILL_SINCE=YYYY-MM-DD` on `sync-notion.js` (which then also requires `NOTION_DATABASE_ID`).

After secrets are set, use **Actions → Update events → Run workflow** to test. The scheduled job runs scrape → Notion sync (`LIMIT=0`) → commit to `public-site` → mirror data to `main`.

## Current status (as of 2026-11-02)

- **Backend (scraper + data + GitHub scrape job): done.** Host filtering on; Luma cover URLs stored as `coverUrl`. Since Oct 2026 the scraper sends a browser-compatible `User-Agent` (Luma started rejecting Node's default with a 429), and it exits with an error instead of overwriting `events.json` if every chapter fails.
- **Notion sync: live in the Climate Designers workspace** (Event Tracking (automated)) as of 2026-11-02. Create-only; Category and Place still manual. Next up: fill the Place column from scraped coordinates so the Notion Map view works.
- **Public site: live on GitHub Pages** from `public-site` — list UI with chapter gradients, cover images, filters, and accordion sections. Calendar/Map not on this branch yet.
- **Daily refresh:** Action updates `public-site` (Pages) and mirrors event data to `main` (usually by mid-afternoon ET; scheduled for 9 AM ET, but GitHub delays scheduled runs).

## Dashboard vs Notion

Both paths are in play:

- **Notion** (Event Tracking (automated), Climate Designers workspace): every scraped chapter's new future events (Luma, Humanitix, Peatix), added daily; visibility stays limited to the workspace. Category and Place still need a human. The team's hand-maintained **Event Tracking (Internal)** database is separate and also covers platforms the scraper doesn't (e.g. connpass, Eventbrite). The sync never reads or writes it.
- **Public site** (GitHub Pages): wider visibility for chapter events; cards open the event's own page.

## Chapters not yet auto-scraped

See the `manual`-source entries in `data/chapters.json` for current reasons (Philippines, Singapore).
