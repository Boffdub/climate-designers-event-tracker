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

const LUMA_USER_AGENT =
  'Mozilla/5.0 (compatible; ClimateDesignersEventTracker/1.0; +https://boffdub.github.io/climate-designers-event-tracker/)';

async function fetchLumaEntries(calendarApiId, period) {
  const url = `https://api.lu.ma/calendar/get-items?calendar_api_id=${calendarApiId}&period=${period}`;
  // Luma rejects Node's default User-Agent with a 429, so identify as a browser-compatible client.
  const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': LUMA_USER_AGENT } });
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

// The global Climate Designers account hosts org-wide events (often virtual) that get
// added to chapter calendars; on its own it shouldn't make an event count as a chapter's.
const GLOBAL_HOSTS = new Set(['climate designers']);

/** Keep if ANY host is approved (co-hosts with partners still pass). */
function matchApprovedHost(hostNames, approvedHosts) {
  const approved = (approvedHosts || []).map(normalizeHostKey);
  const approvedSet = new Set(approved);

  for (const host of hostNames) {
    const key = normalizeHostKey(host);
    if (GLOBAL_HOSTS.has(key)) continue;
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
  // Luma's own venue pin (what its event-page map shows). Far more precise than
  // geocoding the address text, which can fall back to a city-center guess.
  const coord = event.coordinate;
  const lat = coord && Number(coord.latitude);
  const lng = coord && Number(coord.longitude);
  const geo =
    location && location !== 'Virtual' && Number.isFinite(lat) && Number.isFinite(lng)
      ? { lat, lng }
      : undefined;

  return {
    chapter: chapter.name,
    region: chapter.region,
    name: event.name,
    startAt: event.start_at,
    endAt: event.end_at,
    timezone: event.timezone,
    coverUrl: event.cover_url || null, 
    location,
    geo,
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
    const forced = (chapter.alwaysIncludeEvents || []).includes(event.url);
    const match = forced
      ? { ok: true, matchedHost: '(always-include list)' }
      : matchApprovedHost(hosts, chapter.approvedHosts);
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

// Humanitix and Peatix pages belong to the chapter itself (no shared calendar that other
// people add events to), so every event is kept; there's no approvedHosts check.
function ownPageDecisions(events, chapter, label) {
  return events.map((e) => ({
    chapter: chapter.name,
    name: e.name,
    url: e.url,
    hosts: [],
    action: 'kept',
    matchedHost: label,
  }));
}

// Text inside the JSON-LD block is HTML-escaped (e.g. "&amp;"); turn it back into plain text.
function decodeHtmlEntities(text) {
  return (text || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

// "45.4596128, 9.1910265" or "35.641464,139.695579" → { lat, lng }
function parseLatLng(text) {
  const parts = (text || '').split(',').map((s) => parseFloat(s));
  if (parts.length !== 2 || parts.some((n) => Number.isNaN(n))) return null;
  return { lat: parts[0], lng: parts[1] };
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': LUMA_USER_AGENT } });
  if (!res.ok) throw new Error(`Request failed (${res.status}) for ${url}`);
  return res.text();
}

// Humanitix: the host page lists every event (upcoming and past) in data embedded in the
// page; we only take each event's slug and coordinates from it. The details come from each
// event page's schema.org JSON-LD block, a standard format Humanitix keeps stable for Google.
async function scrapeHumanitixChapter(chapter) {
  const hostHtml = await fetchText(`https://events.humanitix.com/host/${chapter.humanitixHost}`);

  // Each event in the embedded data looks like {id:"…",slug:"…",title:"…", … latLng:"…" …}.
  const slugMatches = [...hostHtml.matchAll(/slug:"([^"]+)",title:/g)];
  const slugs = [];
  const geoBySlug = new Map();
  slugMatches.forEach((m, i) => {
    const slug = m[1];
    if (geoBySlug.has(slug)) return; // same event can appear in more than one list
    const end = i + 1 < slugMatches.length ? slugMatches[i + 1].index : hostHtml.length;
    const latLng = hostHtml.slice(m.index, end).match(/latLng:"([^"]+)"/);
    slugs.push(slug);
    geoBySlug.set(slug, latLng ? parseLatLng(latLng[1]) : null);
  });

  const events = [];
  for (const slug of slugs) {
    const html = await fetchText(`https://events.humanitix.com/${slug}`);
    const blocks = [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)];
    const data = blocks.map((b) => JSON.parse(b[1])).find((d) => d['@type'] === 'Event');
    if (!data) throw new Error(`No Event JSON-LD found on Humanitix page ${slug}`);

    const place = data.location || {};
    const online = /Online/.test(data.eventAttendanceMode || '') || place['@type'] === 'VirtualLocation';
    const street = place.address && place.address.streetAddress;
    const venue = decodeHtmlEntities(place.name).trim();
    const location = online ? 'Virtual' : [venue, street].filter(Boolean).join(', ') || null;

    events.push({
      chapter: chapter.name,
      region: chapter.region,
      name: decodeHtmlEntities(data.name).trim(),
      startAt: new Date(data.startDate).toISOString(),
      endAt: data.endDate ? new Date(data.endDate).toISOString() : null,
      timezone: chapter.timezone || null,
      coverUrl: data.image || null,
      location,
      url: `https://events.humanitix.com/${slug}`,
      source: 'humanitix',
      geo: online ? undefined : geoBySlug.get(slug) || undefined,
    });
  }

  return { events, decisions: ownPageDecisions(events, chapter, '(chapter Humanitix page)') };
}

// Peatix: the group page is filled in by JavaScript from Peatix's own (undocumented) API.
// These two endpoints return the group's events as JSON with no login needed.
const PEATIX_LIMIT = 200;

async function fetchPeatixEvents(groupId, list) {
  const url = `https://peatix-api.com/v4/groups/${groupId}/${list}?limit=${PEATIX_LIMIT}`;
  const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': LUMA_USER_AGENT } });
  if (!res.ok) throw new Error(`Peatix API request failed (${res.status}) for group ${groupId} ${list}`);
  const body = await res.json();
  const items = body.data || [];
  // The API has no "next page" option, only a size limit; warn if we might be missing some.
  if (items.length >= PEATIX_LIMIT) {
    console.warn(`Peatix group ${groupId} ${list} returned ${items.length} events; some may be cut off.`);
  }
  return items;
}

function normalizePeatixEvent(item, chapter) {
  const venue = item.locationSettings || {};
  const online = item.locationType === 'online';
  const location = online
    ? 'Virtual'
    : [venue.venueName, venue.venueAddress].filter(Boolean).join(', ') || null;

  return {
    chapter: chapter.name,
    region: chapter.region,
    name: item.name,
    startAt: item.start.utc,
    endAt: (item.end && item.end.utc) || null,
    timezone: item.start.timezone || null,
    coverUrl: (item.details && item.details.coverUrl) || null,
    location,
    url: `https://peatix.com/event/${item.id}`,
    source: 'peatix',
    geo: online ? undefined : parseLatLng(venue.venueGeoCoordinates) || undefined,
  };
}

async function scrapePeatixChapter(chapter) {
  const [upcoming, past] = await Promise.all([
    fetchPeatixEvents(chapter.peatixGroupId, 'upcoming-events'),
    fetchPeatixEvents(chapter.peatixGroupId, 'past-events'),
  ]);

  const byId = new Map();
  for (const item of [...upcoming, ...past]) {
    byId.set(item.id, normalizePeatixEvent(item, chapter));
  }
  const events = [...byId.values()];
  return { events, decisions: ownPageDecisions(events, chapter, '(chapter Peatix group)') };
}

// How far `timeZone` is ahead of UTC at a given moment, in milliseconds (e.g. +8h for Singapore).
function timeZoneOffsetMs(utcMs, timeZone) {
  const parts = {};
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  for (const p of fmt.formatToParts(utcMs)) parts[p.type] = Number(p.value);
  const wallClockAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return wallClockAsUtc - utcMs;
}

// "2026-11-28" + "13:30:00" in "Asia/Singapore" → "2026-11-28T05:30:00.000Z"
function localTimeToUtcIso(date, time, timeZone) {
  const guess = Date.parse(`${date}T${time || '00:00:00'}Z`);
  return new Date(guess - timeZoneOffsetMs(guess, timeZone)).toISOString();
}

// Eventbrite: the organizer page loads its event lists from these JSON endpoints (found in
// the page's JavaScript; not a documented API). Times come as local date + time + timezone.
async function fetchEventbriteEvents(chapter, list) {
  const base = `https://${chapter.eventbriteSite}/organizer-profile/api/organizers/${chapter.eventbriteOrganizerId}/${list}/`;
  const all = [];
  for (let page = 1; page <= 20; page++) {
    const res = await fetch(`${base}?page=${page}&pageSize=50`, {
      headers: { Accept: 'application/json', 'User-Agent': LUMA_USER_AGENT },
    });
    if (!res.ok) throw new Error(`Eventbrite request failed (${res.status}) for ${chapter.name} ${list}`);
    const body = await res.json();
    all.push(...(body.events || []));
    if (!body.hasMore) break;
  }
  return all;
}

function normalizeEventbriteEvent(item, chapter) {
  const venue = item.primary_venue || {};
  const address = venue.address || {};
  const online = Boolean(item.is_online_event);
  const location = online
    ? 'Virtual'
    : [venue.name, address.localized_address_display].filter(Boolean).join(', ') || null;
  const startAt = localTimeToUtcIso(item.start_date, item.start_time, item.timezone);
  const endAt = item.end_date ? localTimeToUtcIso(item.end_date, item.end_time, item.timezone) : null;
  const lat = parseFloat(address.latitude);
  const lng = parseFloat(address.longitude);

  return {
    chapter: chapter.name,
    region: chapter.region,
    name: item.name,
    startAt,
    // The list API reports end = start for events that clearly run longer; treat that as unknown.
    endAt: endAt && endAt !== startAt ? endAt : null,
    timezone: item.timezone || null,
    coverUrl: (item.image && item.image.url) || null,
    location,
    url: item.url,
    source: 'eventbrite',
    geo: !online && !Number.isNaN(lat) && !Number.isNaN(lng) ? { lat, lng } : undefined,
  };
}

async function scrapeEventbriteChapter(chapter) {
  const [upcoming, past] = await Promise.all([
    fetchEventbriteEvents(chapter, 'events'),
    fetchEventbriteEvents(chapter, 'past-events'),
  ]);

  const byId = new Map();
  for (const item of [...upcoming, ...past]) {
    if (item.is_cancelled) continue;
    byId.set(item.id, normalizeEventbriteEvent(item, chapter));
  }
  const events = [...byId.values()];
  return { events, decisions: ownPageDecisions(events, chapter, '(chapter Eventbrite page)') };
}

// Which scraper handles each chapter "source" in chapters.json.
const SCRAPERS = {
  luma: scrapeLumaChapter,
  humanitix: scrapeHumanitixChapter,
  peatix: scrapePeatixChapter,
  eventbrite: scrapeEventbriteChapter,
};

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
    if (event.geo) continue; // platform already gave exact coordinates (all sources usually do)

    if (!(event.location in cache)) {
      cache[event.location] = await geocodeAddress(event.location);
      cacheDirty = true;
    }
    if (cache[event.location]) {
      // Geocoded from address text: may be a city-center fallback. The Notion sync
      // leaves Place blank for these rather than risk a plausible-looking wrong pin.
      event.geo = cache[event.location];
      event.geoApproximate = true;
    }
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

  const scrapedChapters = chapters.filter((c) => SCRAPERS[c.source]);
  const manualChapters = chapters.filter((c) => c.source === 'manual');

  const results = await Promise.all(
    scrapedChapters.map(async (chapter) => {
      try {
        return await SCRAPERS[chapter.source](chapter, filterMode);
      } catch (err) {
        console.error(`Failed to scrape ${chapter.name} (${chapter.source}): ${err.message}`);
        return { events: [], decisions: [], failed: true };
      }
    })
  );

  // If every chapter failed, something is blocking us (most likely Luma, which has most
  // chapters). Exit with an error instead of overwriting events.json with an empty list
  // (which would blank the public site).
  if (scrapedChapters.length > 0 && results.every((r) => r.failed)) {
    throw new Error('All chapters failed to scrape; leaving events.json unchanged.');
  }

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
