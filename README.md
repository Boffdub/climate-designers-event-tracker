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

## Current status (as of 2026-07-15)

- **Backend (scraper + data + automation): done and verified.** Confirmed against the chapters' existing Notion tracker.
- **Frontend: placeholder only.** The current `index.html`/`style.css` don't match the intended look — the user is designing the dashboard in Figma and will bring that design back for implementation. Don't restyle further without it.
- **Hosting: not yet set up.** Repo is private, so plan is Vercel (supports private repos free), not GitHub Pages (requires a public repo). Needs a Vercel account created by the user, then the repo connected for auto-deploy.

## Chapters not yet auto-scraped

See the `manual`-source entries in `data/chapters.json` for current reasons (as of 2026-07-15: Toronto, Dubai, Japan, Philippines, Singapore, Milan). These show up in the dashboard's "Needs setup" section instead of being silently omitted.
