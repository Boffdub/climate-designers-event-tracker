let allEvents = [];
let calendar = null;
let map = null;
let markersLayer = null;

const tableBody = document.getElementById('table-body');
const noEvents = document.getElementById('no-events');
const regionFilter = document.getElementById('filter-region');
const chapterFilter = document.getElementById('filter-chapter');
const timeFilter = document.getElementById('filter-time');

function regionClass(region) {
  return 'region-' + region.toLowerCase().replace(/\s+/g, '-');
}

function formatDate(isoString, timezone) {
  if (!isoString) return '—';
  try {
    return new Date(isoString).toLocaleString('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: timezone || undefined,
    });
  } catch {
    return new Date(isoString).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  }
}

function populateFilters(events) {
  const regions = [...new Set(events.map((e) => e.region))].sort();
  const chapters = [...new Set(events.map((e) => e.chapter))].sort();

  for (const region of regions) {
    const opt = document.createElement('option');
    opt.value = region;
    opt.textContent = region;
    regionFilter.appendChild(opt);
  }

  for (const chapter of chapters) {
    const opt = document.createElement('option');
    opt.value = chapter;
    opt.textContent = chapter;
    chapterFilter.appendChild(opt);
  }
}

function getFilteredEvents() {
  const region = regionFilter.value;
  const chapter = chapterFilter.value;
  const time = timeFilter.value;
  const now = new Date();

  return allEvents.filter((e) => {
    if (region && e.region !== region) return false;
    if (chapter && e.chapter !== chapter) return false;
    if (time === 'upcoming' && new Date(e.startAt) < now) return false;
    if (time === 'past' && new Date(e.startAt) >= now) return false;
    return true;
  });
}

function renderTable() {
  const events = getFilteredEvents();
  tableBody.innerHTML = '';

  if (events.length === 0) {
    noEvents.hidden = false;
    return;
  }
  noEvents.hidden = true;

  for (const e of events) {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td><a href="${e.url}" target="_blank" rel="noopener">${e.name}</a></td>
      <td>${e.chapter}</td>
      <td><span class="region-tag ${regionClass(e.region)}">${e.region}</span></td>
      <td>${formatDate(e.startAt, e.timezone)}</td>
      <td>${e.location || '—'}</td>
    `;
    tableBody.appendChild(row);
  }
}

function renderCalendar() {
  const events = getFilteredEvents().map((e) => ({
    title: `${e.chapter}: ${e.name}`,
    start: e.startAt,
    end: e.endAt,
    url: e.url,
  }));

  if (!calendar) {
    const el = document.getElementById('calendar');
    calendar = new FullCalendar.Calendar(el, {
      initialView: 'dayGridMonth',
      height: 'auto',
      dayMaxEvents: true,
      eventDisplay: 'block',
      events,
      eventClick(info) {
        info.jsEvent.preventDefault();
        window.open(info.event.url, '_blank', 'noopener');
      },
    });
    calendar.render();
  } else {
    calendar.removeAllEvents();
    calendar.addEventSource(events);
  }
}

function renderMap() {
  const events = getFilteredEvents().filter((e) => e.geo);
  const noLocatedEvents = document.getElementById('no-located-events');

  if (!map) {
    map = L.map('map');
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map);
    markersLayer = L.layerGroup().addTo(map);
  }

  markersLayer.clearLayers();

  if (events.length === 0) {
    noLocatedEvents.hidden = false;
    map.setView([20, 0], 2);
    return;
  }
  noLocatedEvents.hidden = true;

  // Group events at (near) the same coordinates so overlapping venues share one marker.
  const groups = new Map();
  for (const e of events) {
    const key = `${e.geo.lat.toFixed(4)},${e.geo.lng.toFixed(4)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }

  const bounds = [];
  for (const [, groupEvents] of groups) {
    const { lat, lng } = groupEvents[0].geo;
    bounds.push([lat, lng]);

    const popupHtml = `<div class="map-popup">${groupEvents
      .map(
        (e) => `
          <div class="map-popup-event">
            <a href="${e.url}" target="_blank" rel="noopener">${e.name}</a><br>
            <span class="map-popup-meta">${e.chapter} · ${formatDate(e.startAt, e.timezone)}</span>
          </div>`
      )
      .join('')}</div>`;

    L.marker([lat, lng]).addTo(markersLayer).bindPopup(popupHtml);
  }

  map.fitBounds(bounds, { padding: [24, 24], maxZoom: 14 });

  // Leaflet needs a resize nudge the first time its container becomes visible.
  setTimeout(() => map.invalidateSize(), 0);
}

function renderFlagged(flaggedChapters) {
  const list = document.getElementById('flagged-list');
  list.innerHTML = '';
  for (const c of flaggedChapters) {
    const li = document.createElement('li');
    li.innerHTML = `
      <span class="chapter-name">${c.name} <span class="region-tag">${c.region}</span></span>
      <span class="reason">${c.reason}</span>
    `;
    list.appendChild(li);
  }
}

const views = {
  table: { section: 'table-view', button: 'btn-table', render: renderTable },
  calendar: { section: 'calendar-view', button: 'btn-calendar', render: renderCalendar },
  map: { section: 'map-view', button: 'btn-map', render: renderMap },
};
let activeView = 'table';

function switchView(view) {
  activeView = view;
  for (const [name, { section, button }] of Object.entries(views)) {
    document.getElementById(section).hidden = name !== view;
    document.getElementById(button).classList.toggle('active', name === view);
  }
  views[view].render();
}

Object.entries(views).forEach(([name, { button }]) =>
  document.getElementById(button).addEventListener('click', () => switchView(name))
);
[regionFilter, chapterFilter, timeFilter].forEach((el) =>
  el.addEventListener('change', () => switchView(activeView))
);

async function init() {
  const res = await fetch('data/events.json');
  const data = await res.json();

  allEvents = data.events;
  document.getElementById('updated-at').textContent = new Date(data.generatedAt).toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  populateFilters(allEvents);
  renderFlagged(data.flaggedChapters);
  switchView('table');
}

init();
