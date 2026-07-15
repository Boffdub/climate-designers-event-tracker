let allEvents = [];
let calendar = null;

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

function switchView(view) {
  const tableSection = document.getElementById('table-view');
  const calendarSection = document.getElementById('calendar-view');
  const btnTable = document.getElementById('btn-table');
  const btnCalendar = document.getElementById('btn-calendar');

  if (view === 'table') {
    tableSection.hidden = false;
    calendarSection.hidden = true;
    btnTable.classList.add('active');
    btnCalendar.classList.remove('active');
    renderTable();
  } else {
    tableSection.hidden = true;
    calendarSection.hidden = false;
    btnTable.classList.remove('active');
    btnCalendar.classList.add('active');
    renderCalendar();
  }
}

document.getElementById('btn-table').addEventListener('click', () => switchView('table'));
document.getElementById('btn-calendar').addEventListener('click', () => switchView('calendar'));
[regionFilter, chapterFilter, timeFilter].forEach((el) =>
  el.addEventListener('change', () => {
    const activeView = document.getElementById('btn-calendar').classList.contains('active') ? 'calendar' : 'table';
    switchView(activeView);
  })
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
