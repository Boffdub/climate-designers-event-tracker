/**
 * Sync scraped events (Luma, Humanitix, Peatix) into a Notion database (create-only).
 *
 * Reads data/events.json (from scrape.js), skips URLs already in Notion,
 * and creates rows for new future events.
 *
 * Required env:
 *   NOTION_TOKEN          Integration secret (ntn_... / secret_...)
 *   NOTION_DATABASE_ID    Target database ID (default: Event Tracker Test)
 *
 * Optional env:
 *   DRY_RUN=1             Print planned creates; do not write to Notion
 *   LIMIT=15              Max new future events to create (0 = no limit)
 *
 * One-time backfill of past events (e.g. when a chapter is first scraped).
 * Both must be set together; NOTION_DATABASE_ID must also be set explicitly:
 *   BACKFILL_CHAPTERS=Japan,Milan   Chapters (names as in chapters.json)
 *   BACKFILL_SINCE=2026-01-01       Include their past events on/after this date
 * Future events for all chapters are still included as normal.
 *
 * Examples:
 *   DRY_RUN=1 NOTION_TOKEN=ntn_... node scripts/sync-notion.js
 *   NOTION_TOKEN=ntn_... LIMIT=15 node scripts/sync-notion.js
 */

const fs = require('fs');
const path = require('path');

const EVENTS_PATH = path.join(__dirname, '..', 'data', 'events.json');
const NOTION_VERSION = '2022-06-28';
const DEFAULT_DATABASE_ID = '3a30471deb0980bf975df71e7ede0c23'; // Event Tracker Test

// Scraper chapter names → Notion "Chapter/Hub" select options (exact match required).
// Chapters with no option (e.g. Seattle) leave Chapter/Hub blank.
const CHAPTER_TO_NOTION = {
  'Bay Area': 'Bay Area Chapter',
  Bengaluru: 'Bengaluru Chapter',
  Boston: 'Boston Chapter',
  Chicago: 'Chicago Chapter',
  Japan: 'Japan Chapter',
  'Los Angeles': 'Los Angeles Chapter',
  Milan: 'Milan Chapter',
  'New York City': 'New York Chapter',
  Toronto: 'Toronto Chapter',
};

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var ${name}`);
  }
  return value;
}

function isDryRun() {
  const v = process.env.DRY_RUN;
  return v === '1' || /^true$/i.test(v || '');
}

function createLimit() {
  if (process.env.LIMIT === undefined || process.env.LIMIT === '') return 15;
  const n = Number(process.env.LIMIT);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error('LIMIT must be a non-negative number (0 = no limit)');
  }
  return n;
}

/** Strip tracking params and normalize lu.ma → luma.com for stable deduping. */
function normalizeEventUrl(url) {
  if (!url) return '';
  try {
    const u = new URL(url.trim());
    let host = u.hostname.replace(/^www\./, '');
    if (host === 'lu.ma') host = 'luma.com';
    const pathname = u.pathname.replace(/\/$/, '') || '';
    return `https://${host}${pathname}`;
  } catch {
    return url.trim().split('?')[0].replace(/\/$/, '');
  }
}

function eventCalendarDate(event) {
  const start = new Date(event.startAt);
  if (Number.isNaN(start.getTime())) return null;

  if (event.timezone) {
    try {
      // en-CA → YYYY-MM-DD
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: event.timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(start);
    } catch {
      // fall through
    }
  }
  return event.startAt.slice(0, 10);
}

function quarterFromDate(dateStr) {
  const [year, month] = dateStr.split('-').map(Number);
  if (!year || !month) return null;
  const q = Math.floor((month - 1) / 3) + 1;
  return `Q${q} ${year}`;
}

function mapFormat(event) {
  if (event.location === 'Virtual') return 'Virtual';
  if (event.location) return 'In person';
  return null; // blank if we can't tell
}

function mapEventToNotionProperties(event) {
  const dateStr = eventCalendarDate(event);
  const properties = {
    'Event name': {
      title: [{ type: 'text', text: { content: event.name || 'Untitled event' } }],
    },
    'Event URL': {
      url: event.url || null,
    },
  };

  if (dateStr) {
    properties['Event date'] = { date: { start: dateStr } };
    const quarter = quarterFromDate(dateStr);
    if (quarter) {
      properties.Quarter = { select: { name: quarter } };
    }
  }

  const chapter = CHAPTER_TO_NOTION[event.chapter];
  if (chapter) {
    properties['Chapter/Hub'] = { select: { name: chapter } };
  }

  const format = mapFormat(event);
  if (format) {
    properties.Format = { select: { name: format } };
  }

  if (event.location && event.location !== 'Virtual') {
    properties.Location = {
      rich_text: [{ type: 'text', text: { content: event.location } }],
    };
  }

  // Category and Place: leave blank (human judgment / unreliable from Luma)
  return properties;
}

async function notionRequest(token, method, apiPath, body) {
  const res = await fetch(`https://api.notion.com/v1${apiPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Notion API returned non-JSON (${res.status}): ${text.slice(0, 200)}`);
  }

  if (!res.ok) {
    const msg = json.message || text.slice(0, 200);
    throw new Error(`Notion API ${method} ${apiPath} failed (${res.status}): ${msg}`);
  }
  return json;
}

/** Paginate the database and collect normalized Event URL → page id. */
async function loadExistingEventUrls(token, databaseId) {
  const byUrl = new Map();
  let cursor;

  do {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;

    const page = await notionRequest(token, 'POST', `/databases/${databaseId}/query`, body);

    for (const row of page.results || []) {
      const urlProp = row.properties && row.properties['Event URL'];
      const raw = urlProp && urlProp.url;
      if (!raw) continue;
      byUrl.set(normalizeEventUrl(raw), row.id);
    }

    cursor = page.has_more ? page.next_cursor : null;
  } while (cursor);

  return byUrl;
}

async function createNotionEvent(token, databaseId, event) {
  return notionRequest(token, 'POST', '/pages', {
    parent: { database_id: databaseId },
    properties: mapEventToNotionProperties(event),
  });
}

/** Returns null when not backfilling, else { chapters: Set, since: Date }. */
function backfillOptions(events) {
  const chaptersEnv = (process.env.BACKFILL_CHAPTERS || '').trim();
  const sinceEnv = (process.env.BACKFILL_SINCE || '').trim();
  if (!chaptersEnv && !sinceEnv) return null;
  if (!chaptersEnv || !sinceEnv) {
    throw new Error('Set BACKFILL_CHAPTERS and BACKFILL_SINCE together (or neither).');
  }
  // A backfill writes many rows at once; never let it fall back to the default database.
  requireEnv('NOTION_DATABASE_ID');

  const since = new Date(`${sinceEnv}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sinceEnv) || Number.isNaN(since.getTime())) {
    throw new Error(`BACKFILL_SINCE must be a date like 2026-01-01 (got "${sinceEnv}")`);
  }

  const chapters = new Set(chaptersEnv.split(',').map((s) => s.trim()).filter(Boolean));
  const known = new Set(events.map((e) => e.chapter));
  const unknown = [...chapters].filter((c) => !known.has(c));
  if (unknown.length) {
    // Catches typos like "Phillipines", which would otherwise silently match nothing.
    throw new Error(`Unknown BACKFILL_CHAPTERS: ${unknown.join(', ')}. Known: ${[...known].sort().join(', ')}`);
  }
  return { chapters, since };
}

function loadEventsToSync() {
  const data = JSON.parse(fs.readFileSync(EVENTS_PATH, 'utf8'));
  const events = (data.events || []).filter((e) => e.url);
  const now = Date.now();
  const backfill = backfillOptions(events);

  const selected = events.filter((e) => {
    const start = new Date(e.startAt).getTime();
    if (start > now) return true; // normal daily behavior: all future events
    return Boolean(backfill && backfill.chapters.has(e.chapter) && start >= backfill.since.getTime());
  });

  return { events: selected.sort((a, b) => new Date(a.startAt) - new Date(b.startAt)), backfill };
}

async function main() {
  const token = requireEnv('NOTION_TOKEN');
  const databaseId = process.env.NOTION_DATABASE_ID || DEFAULT_DATABASE_ID;
  const dryRun = isDryRun();
  const limit = createLimit();

  const { events: future, backfill } = loadEventsToSync();
  if (backfill) {
    console.log(
      `BACKFILL: also including past events for ${[...backfill.chapters].join(', ')} since ${process.env.BACKFILL_SINCE.trim()}`
    );
  }
  console.log(`Loaded ${future.length} event(s) to consider from ${EVENTS_PATH}`);

  const existing = await loadExistingEventUrls(token, databaseId);
  console.log(`Found ${existing.size} existing Event URL(s) in Notion`);

  const toCreate = [];
  let skippedExisting = 0;

  for (const event of future) {
    const key = normalizeEventUrl(event.url);
    if (existing.has(key)) {
      skippedExisting += 1;
      continue;
    }
    toCreate.push(event);
    if (limit > 0 && toCreate.length >= limit) break;
  }

  const remainingNew = future.filter((e) => !existing.has(normalizeEventUrl(e.url))).length;

  console.log(
    [
      dryRun ? 'DRY_RUN=1 (no writes)' : 'LIVE (will create pages)',
      `create ${toCreate.length}`,
      `skip existing ${skippedExisting}`,
      limit > 0 ? `LIMIT=${limit}` : 'LIMIT=none',
      remainingNew > toCreate.length
        ? `(${remainingNew - toCreate.length} more new future event(s) not attempted due to LIMIT)`
        : null,
    ]
      .filter(Boolean)
      .join(' | ')
  );

  for (const event of toCreate) {
    const props = mapEventToNotionProperties(event);
    const chapter = props['Chapter/Hub'] ? props['Chapter/Hub'].select.name : '(blank)';
    const format = props.Format ? props.Format.select.name : '(blank)';
    const date = props['Event date'] ? props['Event date'].date.start : '(blank)';

    if (dryRun) {
      console.log(
        `Would create: ${event.name} | ${date} | ${chapter} | ${format} | ${normalizeEventUrl(event.url)}`
      );
      continue;
    }

    const page = await createNotionEvent(token, databaseId, event);
    console.log(`Created: ${event.name} → ${page.url}`);
  }

  if (!dryRun && toCreate.length === 0) {
    console.log('Nothing to create.');
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
