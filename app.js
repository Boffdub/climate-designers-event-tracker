let allEvents = [];

const upcomingList = document.getElementById('upcoming-list');
const pastList = document.getElementById('past-list');
const regionFilter = document.getElementById('filter-region');
const chapterFilter = document.getElementById('filter-chapter');

function formatTimeRange(startAt, endAt, timezone) {
  const opts = { hour: 'numeric', minute: '2-digit', timeZone: timezone || undefined };
  const start = new Date(startAt).toLocaleTimeString('en-US', opts);
  if (!endAt) return start;
  const end = new Date(endAt).toLocaleTimeString('en-US', opts);
  return `${start} – ${end}`;
}

function formatMonthDay(startAt, timezone) {
  const month = new Date(startAt)
    .toLocaleString('en-US', {
      month: 'short',
      timeZone: timezone || undefined,
    })
    .toUpperCase();
  const day = new Date(startAt).toLocaleString('en-US', {
    day: 'numeric',
    timeZone: timezone || undefined,
  });
  return { month, day };
}

function chapterGradient(chapter) {
  const map = {
    'New York City': 'var(--new-york-chapter)',
    Bengaluru: 'var(--bengaluru-chapter)',
    Toronto: 'var(--toronto-chapter)',
    Boston: 'var(--boston-chapter)',
    'Bay Area': 'var(--bay-area-chapter)',
    'Los Angeles': 'var(--los-angeles-chapter)',
    // add Seattle / Chicago / Dubai when you have CSS vars for them
  };
  return map[chapter] || 'var(--new-york-chapter)';
}

function eventCardHtml(e) {
  const { month, day } = formatMonthDay(e.startAt, e.timezone);
  const time = formatTimeRange(e.startAt, e.endAt, e.timezone);
  const location = e.location || 'Register to see address';
  const gradient = chapterGradient(e.chapter);

  const thumbStyle = e.coverUrl
    ? `style="background-image: url('${e.coverUrl}')"`
    : '';

  return `
    <a class="event-card" href="${e.url}" target="_blank" rel="noopener"
       style="background: ${gradient}">
      <div class="event-thumb" ${thumbStyle}></div>
      <div class="event-info">
        <h3 class="event-title">${e.name}</h3>
        <p class="event-chapter">${e.chapter} Chapter</p>
        <p class="event-meta">${time}</p>
        <p class="event-meta">${location}</p>
      </div>
      <div class="event-date">
        <span class="month">${month}</span>
        <span class="day">${day}</span>
      </div>
    </a>
  `;
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

function renderList() {
  const now = new Date();
  const filtered = getFilteredEvents();

  const upcoming = filtered
    .filter((e) => new Date(e.startAt) >= now)
    .sort((a, b) => new Date(a.startAt) - new Date(b.startAt));

  const past = filtered
    .filter((e) => new Date(e.startAt) < now)
    .sort((a, b) => new Date(b.startAt) - new Date(a.startAt));

  upcomingList.innerHTML = upcoming.map(eventCardHtml).join('');
  pastList.innerHTML = past.map(eventCardHtml).join('');
}

const listView = document.getElementById('list-view');
const calendarView = document.getElementById('calendar-view');
const btnTable = document.getElementById('btn-table');
const btnCalendar = document.getElementById('btn-calendar');

function showListView() {
  listView.hidden = false;
  calendarView.hidden = true;
  btnTable.classList.add('active');
  btnCalendar.classList.remove('active');
  renderList();
}

function showCalendarView() {
  listView.hidden = true;
  calendarView.hidden = false;
  btnTable.classList.remove('active');
  btnCalendar.classList.add('active');
  calendar.updateSize();
  renderCalendar();

  const todayCell = calendarEl.querySelector('.fc-day-today');
  if (todayCell) {
    todayCell.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

btnTable.addEventListener('click', showListView);
btnCalendar.addEventListener('click', showCalendarView);

[regionFilter, chapterFilter].forEach((el) =>
  el.addEventListener('change', () => {
    renderList();
    renderCalendar();
  })
);

const calendarEl = document.getElementById('calendar');
let calendar = null;

function getFilteredEvents() {
  const region = regionFilter.value;
  const chapter = chapterFilter.value;
  return allEvents.filter((e) => {
    if (region && e.region !== region) return false;
    if (chapter && e.chapter !== chapter) return false;
    return true;
  });
}

function renderCalendar() {
  const fcEvents = getFilteredEvents().map((e) => ({
    title: e.name,
    start: e.startAt,
    end: e.endAt,
    extendedProps: {
      coverUrl: e.coverUrl,
      chapter: e.chapter,
      url: e.url,
    },
  }));

  calendar.removeAllEvents();
  calendar.addEventSource(fcEvents);
}

function initCalendar() {
  calendar = new FullCalendar.Calendar(calendarEl, {
    initialView: 'dayGridMonth',
    events: [],
    eventContent: function (arg) {
      const props = arg.event.extendedProps;
      const thumbStyle = props.coverUrl
        ? `style="background-image: url('${props.coverUrl}')"`
        : '';
      const gradient = chapterGradient(props.chapter);

      return {
        html: `
          <div class="fc-event-custom" style="background: ${gradient}">
            <div class="fc-event-thumb" ${thumbStyle}></div>
            <span class="fc-event-title">${arg.event.title}</span>
          </div>
        `,
      };
    },
    eventClick: function (info) {
      info.jsEvent.preventDefault();
      window.open(info.event.extendedProps.url, '_blank', 'noopener');
    },
  });
  calendar.render();
}


document.querySelectorAll('.chevron').forEach((chevron) => {
  chevron.addEventListener('click', (e) => {
    e.stopPropagation();
    chevron.closest('.event-group').classList.toggle('open');
  });
});

async function init() {
  const res = await fetch('data/events.json');
  const data = await res.json();

  allEvents = data.events;
  document.getElementById('updated-at').textContent = new Date(data.generatedAt).toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  populateFilters(allEvents);
  renderList();
  initCalendar();
}

init();
