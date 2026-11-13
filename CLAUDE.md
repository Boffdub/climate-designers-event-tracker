# CLAUDE.md

Guidance for Claude Code in this repo. The README is the source of truth for how the project works — read it first. This file covers what the README doesn't: gotchas, rules, and working conventions.

## What this is

Scrapes every Climate Designers chapter's public event page (Luma; Humanitix for Milan; Peatix for Japan; Eventbrite for Singapore) → `data/events.json` → (a) a static public site on GitHub Pages and (b) a create-only sync into a Notion database. Plain Node, no dependencies, no build step.

## Branches (important)

- `public-site` — what GitHub Pages serves **and** the branch the daily Action checks out and commits to. Frontend (`index.html`, `app.js`, `style.css`) lives here.
- `main` — scraper/sync/workflow source; receives a mirrored copy of the data files.
- The Action commits `Update events.json` daily, so local branches fall behind fast. Run `git fetch` / `git pull` before changing anything, and check which branch you're on.
- Code changes to `scripts/` or `.github/workflows/` need to land on **`public-site`** to affect the daily run (that's the branch the workflow checks out).

## Commands

```bash
node scripts/scrape.js                          # regenerate data/events.json
HOST_FILTER=review node scripts/scrape.js       # log host-filter keep/skip decisions
DRY_RUN=1 NOTION_DATABASE_ID=<id> node scripts/sync-notion.js   # preview Notion writes (NOTION_TOKEN exported first; see Notion)
python3 -m http.server 8934                     # view site at http://localhost:8934/
```

There is no test suite. "Verify" means: run the scraper, check the event count in its output, and load the site locally.

## Host filtering (which events count as a chapter's)

Each Luma chapter in `data/chapters.json` has `approvedHosts`. An event is kept if **any** host is approved, or any host's name contains "Climate Designers" (safety net in `matchApprovedHost`). Exceptions:
- `GLOBAL_HOSTS` in `scrape.js`: the global "Climate Designers" account never counts as a match **on its own**, since its org-wide events get added to chapter calendars. Co-hosted with the chapter → still kept.
- `alwaysIncludeEvents` (optional, per chapter): list of full Luma URLs (`https://luma.com/<slug>`) kept regardless of hosts. Use for one-offs instead of approving a broad co-host. Currently used for the Bay Area "Doom & Bloom" podcast.
- `HOST_FILTER=review node scripts/scrape.js` prints why each event was kept or skipped.

## Gotchas

- **Luma blocks non-browser clients.** Since ~2026-10-14, `api.lu.ma` returns `429 "rate limit"` to Node's default `User-Agent`, even on the first request. `scrape.js` sends `LUMA_USER_AGENT` to get around this. If 429s come back, suspect Luma changed its blocking again, not real rate limiting. Compare with `curl -A "Mozilla/5.0 ..."`.
- **Peatix's and Eventbrite's APIs are undocumented.** Both found by reading the sites' frontend JavaScript (`peatix-api.com/v4`; Eventbrite's `/organizer-profile/api/organizers/...`). If Japan's or Singapore's events vanish, check the endpoints in the README still respond. Eventbrite's older `/org/<id>/showmore/` endpoint is blocked (403). Humanitix is read from page HTML (embedded data + JSON-LD), so a Humanitix redesign can break it the same way.
- **Partial failures are silent.** If *some* chapters fail, they're logged and skipped, and the Action still passes. Only an *all*-chapters failure exits with an error (leaving `events.json` untouched, so the Action goes red). If a chapter's events go missing, check the scraper log for `Failed to scrape`.
- Under `file://` the site won't load data (`fetch` restriction). Always use a local server.
- Never commit `NOTION_TOKEN`. It lives in GitHub Actions secrets.
- **Code style: single quotes, no formatter.** Brett's VS Code had format-on-save (Prettier) reformat whole files; `.vscode/settings.json` (local, uncommitted) turns it off here. If a diff shows mass quote/line-wrap changes, that's the formatter. Keep logic changes separate from style churn.

## Chapter colors (public site)

- Each chapter's card gradient is a `--<chapter>-chapter` variable in `style.css`, mapped by chapter name in `chapterGradient()` in `app.js`. A chapter missing from the map falls back to the NYC gradient. Every scraped chapter has one; Philippines doesn't yet (it and Seattle may close soon).
- The hex values come from the chapters' official brand gradients (Brett copies them from Figma). Don't suggest changing them, even when two look alike (e.g. Dubai and Bengaluru).
- The site's gradients run top to bottom (no angle), unlike the diagonal ones in the official artwork. That's intentional; leave them as is.

## Notion

- `sync-notion.js` is **create-only** (dedupes by `Event URL`, never edits or deletes). It expects these properties on the target database: `Event name` (title), `Event URL`, `Event date`, `Quarter` (select), `Chapter/Hub` (select), `Format` (select), `Location`, `Place` (Place type). Category is left blank for humans.
- **Place (for the Map view; Map reads only Place-type columns, never text):** filled only from the platform's own venue pin (`event.geo` without `geoApproximate`). Luma's comes from the API's `coordinate` field. Nominatim geocoding is only a fallback and is marked `geoApproximate`, because a failed lookup silently falls back to a city-center pin (e.g. different LA venues had landed on the same downtown spot). Brett's rule: **a blank Place beats a plausible wrong one**, since the team can't tell a wrong pin is wrong. If Notion rejects the Place value, `createNotionEvent` retries without it and logs a warning, so the row isn't lost.
- `Chapter/Hub` values come from `CHAPTER_TO_NOTION` in `sync-notion.js` (e.g. `Boston` → `Boston Chapter`). They must exactly match the target database's select options, or Notion silently creates a new, near-duplicate option. Chapters missing from the map (e.g. Seattle, Dubai) get a blank Chapter/Hub.
- **Production target (since 2026-11-02):** "Event Tracking (automated)" in the **Climate Designers** workspace, `408498810e4180ad90bfcdfb254ac159`, set via the `NOTION_DATABASE_ID` secret. The script's fallback when that's unset is still Brett's personal **Event Tracker Test** (`3a30471deb0980bf975df71e7ede0c23`), which is now a sandbox.
- **Always dry-run (`DRY_RUN=1`) and show Brett the output before any live Notion write**, especially against the Climate Designers workspace, which other people use. For a first live write after a change, use `LIMIT=1`.
- **Never ask Brett to paste a token into chat.** Have him load it with `read -s "NOTION_TOKEN?..." && export NOTION_TOKEN` in his own terminal. Tokens copied from Signal or Slack can carry an invisible extra character, which causes a 401 "API token is invalid". Check with `echo ${#NOTION_TOKEN}` (should be 50) and strip it with `tr -cd 'A-Za-z0-9_'`.
- **Climate Designers workspace constraints:** Brett is a **Guest**. He can't move pages in from other workspaces or create integrations. Natalie (workspace owner) created the integration with **Read + Insert content only**, so it can't edit or delete rows. Any change that needs to *update* existing rows needs her to add that capability.
- The automated database gets **every scraped chapter's** events, not just Luma (Brett decided 2026-11-11 to include Milan/Humanitix and Japan/Peatix). The team's hand-maintained **"Event Tracking (Internal)"** (Brett and Yutieka; it also covers connpass, Eventbrite) is separate, and the sync never touches it. Don't hand-copy Internal rows into the automated database.

## In progress / to do

**Script cleanup (proposed, not approved yet):** make `NOTION_DATABASE_ID` required in `sync-notion.js` (`requireEnv`) and drop the `DEFAULT_DATABASE_ID` fallback, so a local run can never silently target a database nobody chose. Update the README's database table when it lands.

**Before the next backfill: add a duplicate warning.** Dedupe is by `Event URL` only. The 2026-11-11 Japan/Milan backfill created 2 duplicates of rows someone had hand-entered with a different URL (Feb 18 Tech Inspiration Espresso; Mar 5 Da Eco-Ansia), which Brett removed by hand (the integration can't delete). Idea: in backfill mode, flag (not skip) events whose chapter + date already exist in Notion, so the dry run shows them.

**Backfills:** run them from GitHub (Actions → "Backfill Notion (manual)"), not locally. That uses the `NOTION_TOKEN` secret, so Brett never handles the token; his local copy of Natalie's token didn't work (54 chars, 401 even after cleanup). Steps: dry run → limit 1 → limit 0. Done so far (all since 2026-01-01, on 2026-11-11): Japan + Milan; Singapore (1 event, Decolonising Design).

**If Internal and automated are ever merged** (e.g. the sync writes into Internal): first add a dedupe fallback (same `Event date` + same name), because URLs differ between trackers (e.g. Ripple Effects Mapping: luma.com in Test, givebutter in Internal).

**Place column (code written 2026-11-12, testing):** `mapPlace` in `sync-notion.js` writes `{ place: { lat, lon, name, address } }` (name = address text before the first comma). Still to confirm with a `LIMIT=1` live test against Event Tracker Test that `NOTION_VERSION` 2022-06-28 accepts `place`. Only new rows get Place (create-only). **Existing rows: the team fills Place by hand for now (Brett's decision 2026-11-12).** Maybe later: ask Natalie to tick "Update content" on the existing integration (same token, no new secret needed), then build a one-time "fill empty Place cells" workflow like the backfill (dry run → limit 1 → all; only empty cells, only exact pins).

## Working with Brett

Brett is a UX designer learning to code (see global CLAUDE.md). In this repo specifically:
- Explain the *why* behind a fix, not just the diff.
- Show proposed changes and wait for approval; don't commit or push without asking. Pushing to `public-site` changes the live public site.
