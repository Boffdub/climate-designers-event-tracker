const fs = require('fs');
const path = require('path');

const CHAPTERS_PATH = path.join(__dirname, '..', 'data', 'chapters.json');
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'events.json');
const GEOCACHE_PATH = path.join(__dirname, '..', 'data', 'geocache.json');
const NOMINATIM_USER_AGENT = 'climate-designers-event-tracker (https://github.com/Boffdub/climate-designers-event-tracker)';

// Host filter modes (env HOST_FILTER):
//   unset / on   — exclude events with no approved host (default)
//   review       — log kept/skipped decisions, but still include all events
//   off          — include every calendar event
function hostFilterMode() {
  const v = (process.env.HOST_FILTER || 'on').trim().toLowerCase();
  if (v === '0' || v === 'off' || v === 'false') return 'off';
  if (v === 'review' || v === 'dry_run' || v === 'dry-run') return 'review';
  if (v === '1' || v === 'on' || v === 'true' || v === 'filter') return 'on';
  throw new Error(`Unknown HOST_FILTER="${process.env.HOST_FILTER}" (use off, review, or on)`);
}

async function fetchLumaEntries(calendarApiId, period) {
  const url = `https://api.lu.ma/calendar/get-items?calendar_api_id=${calendarApiId}&period=${period}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(`Luma API request failed (${res.status}) for ${calendarApiId} period=${period}`);
  }
  const body = await res.json();
  return body.entries || [];
}

function entryHostNames(entry) {
  return (entry.hosts || [])
    .map((h) => (h && h.name) || '')
    .map((n) => n.trim())
    .filter(Boolean);
}

function normalizeHostKey(name) {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Keep if ANY host is approved (co-hosts with partners still pass). */
function matchApprovedHost(hostNames, approvedHosts) {
  const approved = (approvedHosts || []).map(normalizeHostKey);
  const approvedSet = new Set(approved);

  for (const host of hostNames) {
    const key = normalizeHostKey(host);
    if (approvedSet.has(key)) {
      return { ok: true, matchedHost: host };
    }
    // Safety net: any host whose display name contains "Climate Designers"
    if (/climate\s*designers/i.test(host)) {
      return { ok: true, matchedHost: host };
    }
  }
  return { ok: false, matchedHost: null };
}

function normalizeLumaEvent(entry, chapter) {
  const event = entry.event;
  const address = event.geo_address_info;
  const location =
    event.location_type === 'online'
      ? 'Virtual'
      : (address && (address.full_address || address.address)) || null;

  return {
    chapter: chapter.name,
    region: chapter.region,
    name: event.name,
    startAt: event.start_at,
    endAt: event.end_at,
    timezone: event.timezone,
    coverUrl: event.cover_url || null, 
    location,
    url: `https://luma.com/${event.url}`,
    source: 'luma',
    hosts: entryHostNames(entry),
  };
}

async function scrapeLumaChapter(chapter, filterMode) {
  const [future, past] = await Promise.all([
    fetchLumaEntries(chapter.calendarApiId, 'future'),
    fetchLumaEntries(chapter.calendarApiId, 'past'),
  ]);

  const byId = new Map();
  const decisions = [];

  for (const entry of [...future, ...past]) {
    const event = normalizeLumaEvent(entry, chapter);
    const hosts = event.hosts;
    const match = matchApprovedHost(hosts, chapter.approvedHosts);
    const decision = {
      chapter: chapter.name,
      name: event.name,
      url: event.url,
      hosts,
      action: match.ok ? 'kept' : 'skipped',
      matchedHost: match.matchedHost,
    };
    decisions.push(decision);

    if (filterMode === 'review' || filterMode === 'off') {
      // Always include in output while reviewing / when filter is off
      byId.set(entry.event.api_id, event);
    } else if (match.ok) {
      byId.set(entry.event.api_id, event);
    }
  }

  return { events: [...byId.values()], decisions };
}

function loadGeocache() {
  try {
    return JSON.parse(fs.readFileSync(GEOCACHE_PATH, 'utf8'));
  } catch {
    return {};
  }
}

async function queryNominatim(q) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { 'User-Agent': NOMINATIM_USER_AGENT } });
  await new Promise((resolve) => setTimeout(resolve, 1100)); // stay under Nominatim's 1 req/sec usage policy
  if (!res.ok) {
    console.error(`Geocoding request failed (${res.status}) for "${q}"`);
    return null;
  }
  const results = await res.json();
  if (!results.length) return null;
  return { lat: parseFloat(results[0].lat), lng: parseFloat(results[0].lon) };
}

// Nominatim's free-text parser often can't place a query that leads with a
// venue name (e.g. "Barcade, 148 W 24th St, New York, NY 10011, USA"). Retry
// with that leading segment stripped, down to city/state/country, so every
// address resolves to at least a city-level pin instead of being dropped
// from the map entirely.
async function geocodeAddress(address) {
  const segments = address.split(',').map((s) => s.trim()).filter(Boolean);
  for (let start = 0; start < segments.length - 1; start++) {
    const result = await queryNominatim(segments.slice(start).join(', '));
    if (result) return result;
  }
  return null;
}

// Geocoding results are cached by address in data/geocache.json so repeat scrapes
// (this runs daily) don't re-hit Nominatim for venues we've already resolved.
async function geocodeEvents(events) {
  const cache = loadGeocache();
  let cacheDirty = false;

  for (const event of events) {
    if (!event.location || event.location === 'Virtual') continue;

    if (!(event.location in cache)) {
      cache[event.location] = await geocodeAddress(event.location);
      cacheDirty = true;
    }
    event.geo = cache[event.location];
  }

  if (cacheDirty) {
    fs.writeFileSync(GEOCACHE_PATH, JSON.stringify(cache, null, 2) + '\n');
  }
}

function logHostFilterDecisions(decisions, filterMode) {
  const kept = decisions.filter((d) => d.action === 'kept');
  const skipped = decisions.filter((d) => d.action === 'skipped');

  console.log(`\nHost filter (${filterMode}): ${kept.length} would keep, ${skipped.length} would skip`);

  for (const d of kept) {
    console.log(
      `  kept because host "${d.matchedHost}": ${d.name} [${d.chapter}] ${d.url}`
    );
  }
  for (const d of skipped) {
    const hostList = d.hosts.length ? d.hosts.join(', ') : '(no hosts)';
    console.log(`  skipped because hosts: ${hostList} — ${d.name} [${d.chapter}] ${d.url}`);
  }
}

async function main() {
  const filterMode = hostFilterMode();
  const chapters = JSON.parse(fs.readFileSync(CHAPTERS_PATH, 'utf8'));

  const lumaChapters = chapters.filter((c) => c.source === 'luma');
  const manualChapters = chapters.filter((c) => c.source === 'manual');

  const results = await Promise.all(
    lumaChapters.map(async (chapter) => {
      try {
        return await scrapeLumaChapter(chapter, filterMode);
      } catch (err) {
        console.error(`Failed to scrape ${chapter.name}: ${err.message}`);
        return { events: [], decisions: [] };
      }
    })
  );

  const allDecisions = results.flatMap((r) => r.decisions);
  if (filterMode === 'review' || filterMode === 'on') {
    logHostFilterDecisions(allDecisions, filterMode);
  }

  const events = results
    .flatMap((r) => r.events)
    .map(({ hosts, ...event }) => event) // hosts used for filtering only; omit from public JSON
    .sort((a, b) => new Date(a.startAt) - new Date(b.startAt));

  await geocodeEvents(events);

  const output = {
    generatedAt: new Date().toISOString(),
    events,
    flaggedChapters: manualChapters.map((c) => ({
      name: c.name,
      region: c.region,
      reason: c.reason,
    })),
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2) + '\n');
  console.log(`\nWrote ${events.length} events and ${output.flaggedChapters.length} flagged chapters to ${OUTPUT_PATH}`);
  if (filterMode === 'review') {
    console.log('HOST_FILTER=review: events.json still includes skipped events. Set HOST_FILTER=on to exclude them.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
