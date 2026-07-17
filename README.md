# Climate Designers Event Tracker

A dashboard that pulls upcoming and past events from every Climate Designers chapter's public calendar into one place, so the internal team (including Marc) can see all chapters' events without checking each one by hand.

## Why this exists

The North American Regional Lead previously checked each chapter's Luma/Peatix page weekly and copied new events into an internal Notion database by hand. This project automates that: a scraper pulls events from each chapter's calendar on a schedule, and a static dashboard displays them.

## How it works

1. **`data/chapters.json`** — one entry per chapter: name, region, and either a `luma` source with a resolved `calendarApiId`, or a `manual` source with a `reason` the chapter isn't auto-scraped yet.
2. **`scripts/scrape.js`** — plain Node script (no dependencies). For each `luma` chapter, calls Luma's public JSON API (`https://api.lu.ma/calendar/get-items?calendar_api_id=<id>&period=future|past`), merges and dedupes events, and writes the result to `data/events.json`.
3. **`.github/workflows/update-events.yml`** — GitHub Actions job, scheduled daily, that runs the scraper and commits `data/events.json` if it changed. Also runnable manually from the Actions tab (`workflow_dispatch`).
4. **`index.html` / `style.css` / `app.js`** — static frontend that fetches `data/events.json` client-side and renders a table view, a calendar view, and a "needs setup" section for chapters that aren't auto-scraped.

No build step, no backend server — everything is static files plus a scheduled script.

### Resolving a new chapter's `calendarApiId`

Luma calendar pages embed a `__NEXT_DATA__` script tag containing `props.pageProps.initialData.data.calendar.api_id`. Fetch the chapter's Luma page HTML once, pull that ID out, and add it to `data/chapters.json` — after that, `scrape.js` only ever calls the stable JSON API, never re-parses HTML.

## Running locally

```bash
node scripts/scrape.js   # regenerates data/events.json
python3 -m http.server 8934   # or any static file server
```

Then open `http://localhost:8934/`.

## Current status (as of 2026-07-17)

- **Backend (scraper + data + automation): done and verified.** Confirmed against the chapters' existing Notion tracker.
- **Frontend: in progress, styled to match the real Climate Designers brand** (colors/fonts pulled from https://www.climatedesigners.org/styleguide — Archivo Black headings, dark header, bright accent palette). The user is iterating on `style.css`/`index.html` directly in Chrome DevTools (open via `http://localhost:8934/`, not the `index.html` file directly — `fetch()` doesn't work under the `file://` protocol) and may still bring in a Figma design on top of this. Small pending polish items get fixed as they're noticed (e.g. region-tag pill sizing, filter alignment).
- **Hosting: not yet set up.** Repo is private, so plan is Vercel (supports private repos free), not GitHub Pages (requires a public repo). Needs a Vercel account created by the user, then the repo connected for auto-deploy.
- **Open question: standalone dashboard vs. writing into the existing Notion tracker.** The user is also considering having the scraper write new events directly into the internal Notion database ("Event Tracking (Internal)") via Notion's API instead of (or alongside) this dashboard — free either way. Current lean is toward keeping the standalone dashboard, since the longer-term goal is to make chapter events **publicly** visible (not just the ~5 people with internal Notion access) and eventually embed this on the Climate Designers Squarespace site, which a public Notion page doesn't do well. Not decided yet.

## Chapters not yet auto-scraped

See the `manual`-source entries in `data/chapters.json` for current reasons (as of 2026-07-15: Toronto, Dubai, Japan, Philippines, Singapore, Milan). These show up in the dashboard's "Needs setup" section instead of being silently omitted.
