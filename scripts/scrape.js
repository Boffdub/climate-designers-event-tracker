const fs = require('fs');
const path = require('path');

const CHAPTERS_PATH = path.join(__dirname, '..', 'data', 'chapters.json');
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'events.json');

async function fetchLumaEntries(calendarApiId, period) {
  const url = `https://api.lu.ma/calendar/get-items?calendar_api_id=${calendarApiId}&period=${period}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(`Luma API request failed (${res.status}) for ${calendarApiId} period=${period}`);
  }
  const body = await res.json();
  return body.entries || [];
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
    location,
    url: `https://luma.com/${event.url}`,
    source: 'luma',
  };
}

async function scrapeLumaChapter(chapter) {
  const [future, past] = await Promise.all([
    fetchLumaEntries(chapter.calendarApiId, 'future'),
    fetchLumaEntries(chapter.calendarApiId, 'past'),
  ]);

  const byId = new Map();
  for (const entry of [...future, ...past]) {
    byId.set(entry.event.api_id, normalizeLumaEvent(entry, chapter));
  }
  return [...byId.values()];
}

async function main() {
  const chapters = JSON.parse(fs.readFileSync(CHAPTERS_PATH, 'utf8'));

  const lumaChapters = chapters.filter((c) => c.source === 'luma');
  const manualChapters = chapters.filter((c) => c.source === 'manual');

  const results = await Promise.all(
    lumaChapters.map(async (chapter) => {
      try {
        return await scrapeLumaChapter(chapter);
      } catch (err) {
        console.error(`Failed to scrape ${chapter.name}: ${err.message}`);
        return [];
      }
    })
  );

  const events = results
    .flat()
    .sort((a, b) => new Date(a.startAt) - new Date(b.startAt));

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
  console.log(`Wrote ${events.length} events and ${output.flaggedChapters.length} flagged chapters to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
