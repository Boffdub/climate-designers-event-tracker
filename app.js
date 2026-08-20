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
  const region = regionFilter.value;
  const chapter = chapterFilter.value;
  const now = new Date();

  const filtered = allEvents.filter((e) => {
    if (region && e.region !== region) return false;
    if (chapter && e.chapter !== chapter) return false;
    return true;
  });

  const upcoming = filtered
    .filter((e) => new Date(e.startAt) >= now)
    .sort((a, b) => new Date(a.startAt) - new Date(b.startAt));

  const past = filtered
    .filter((e) => new Date(e.startAt) < now)
    .sort((a, b) => new Date(b.startAt) - new Date(a.startAt));

  upcomingList.innerHTML = upcoming.map(eventCardHtml).join('');
  pastList.innerHTML = past.map(eventCardHtml).join('');
}

document.getElementById('btn-table').addEventListener('click', () => renderList());
[regionFilter, chapterFilter].forEach((el) =>
  el.addEventListener('change', () => renderList())
);

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
}

init();
