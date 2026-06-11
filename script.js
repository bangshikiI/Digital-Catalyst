/* ================================================================
   Digital Catalyst — Production Tracker
   script.js — Data fetching, parsing, rendering, interactions
   ================================================================ */

'use strict';

// ── CONFIG ───────────────────────────────────────────────────────
const CONFIG = {
  // The published spreadsheet ID (from the /e/ path of the pubhtml URL)
  SHEET_ID: '2PACX-1vQ7XIOkNZeClpn7HYk65PIkFl8ryhADFmGIYbOaJOOnnI8-NON-Jv6H3EJc9MrSgsgsVcDHUGhJowsz',
  // Use the published CSV export URL format for public sheets
  USE_PUB_CSV: true,
  TABS: ['DC', 'Jeya', 'L&S', 'LHF', 'Boney', 'Aida', 'AMmarket', 'Chef', 'Goreng', 'Mavi', 'Saddam'],
  ROWS_PER_PAGE: 25,
  // gid (sheet index) map — will be discovered dynamically or fallback to index
  GID_MAP: {
    'DC': 0,
    'Jeya': 1,
    'L&S': 2,
    'LHF': 3,
    'Boney': 4,
    'Aida': 5,
    'AMmarket': 6,
    'Chef': 7,
    'Goreng': 8,
    'Mavi': 9,
    'Saddam': 10,
  },
};

// ── STATE ─────────────────────────────────────────────────────────
const state = {
  allProjects: [],
  filtered: [],
  currentPage: 1,
  sortCol: 'date',
  sortDir: 'desc',
  charts: {},
  lastSync: null,
};

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTH_FULL  = ['January','February','March','April','May','June','July','August','September','October','November','December'];

const CLIENT_COLORS = [
  '#60a5fa','#a78bfa','#34d399','#f59e0b','#f87171',
  '#38bdf8','#fb923c','#c084fc','#4ade80','#e879f9','#facc15',
];

// ── ENTRY POINT ───────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initNav();
  initTable();
  loadAllData();
  setInterval(() => loadAllData(), 60000);
});

// ── NAVIGATION ────────────────────────────────────────────────────
function initNav() {
  const links      = document.querySelectorAll('.nav-link');
  const pages      = document.querySelectorAll('.page');
  const hamburger  = document.getElementById('hamburger');
  const navLinks   = document.getElementById('navLinks');
  const refreshBtn = document.getElementById('refreshBtn');

  links.forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      const target = link.dataset.page;
      links.forEach(l => l.classList.remove('active'));
      link.classList.add('active');
      pages.forEach(p => p.classList.remove('active'));
      document.getElementById('page-' + target).classList.add('active');
      navLinks.classList.remove('open');
      if (target === 'analytics' && state.allProjects.length) renderCharts();
    });
  });

  hamburger.addEventListener('click', () => navLinks.classList.toggle('open'));

  refreshBtn.addEventListener('click', () => {
    refreshBtn.classList.add('spinning');
    loadAllData().finally(() => refreshBtn.classList.remove('spinning'));
  });
}

// ── DATA LOADING ──────────────────────────────────────────────────
async function loadAllData() {
  showSkeletons();

  const results = await Promise.allSettled(
    CONFIG.TABS.map((tab, i) => fetchSheetCSV(tab, i))
  );

  const allRows = [];

  results.forEach((result, i) => {
    if (result.status === 'fulfilled' && result.value.length) {
      result.value.forEach(row => allRows.push({ ...row, client: CONFIG.TABS[i] }));
    } else if (result.status === 'rejected') {
      console.warn('Failed to load tab:', CONFIG.TABS[i], result.reason);
    }
  });

  if (!allRows.length) {
    showError();
    return;
  }

  state.allProjects = allRows;
  state.lastSync = new Date();
  document.getElementById('syncLabel').textContent =
    'Synced ' + state.lastSync.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  buildFilterOptions();
  renderDashboard();

  if (document.getElementById('page-analytics').classList.contains('active')) {
    renderCharts();
  }
  applyFiltersAndRender();
}

function showSkeletons() {
  document.getElementById('kpiGrid').innerHTML = Array(8).fill(`
    <div class="kpi-card skeleton">
      <div class="kpi-shimmer"></div>
      <div class="kpi-label" style="opacity:.3">Loading…</div>
      <div class="kpi-value" style="opacity:.15">—</div>
    </div>`).join('');
}

function showError() {
  document.getElementById('kpiGrid').innerHTML = `
    <div class="error-banner">
      <div class="error-icon">⚠️</div>
      <div class="error-title">Could not load sheet data</div>
      <div class="error-body">
        Make sure the Google Sheet is published to the web.<br><br>
        In Google Sheets: <strong>File → Share → Publish to web → Publish</strong>
      </div>
    </div>`;
  document.getElementById('monthlyGrid').innerHTML = '';
  document.getElementById('clientGrid').innerHTML = '';
  document.getElementById('spotlightRow').innerHTML = '';
  document.getElementById('projectTableBody').innerHTML =
    '<tr><td colspan="8" class="table-loading">Sheet not accessible.</td></tr>';
}

/**
 * Fetch a single tab via published CSV (works for "publish to web" sheets).
 * Column layout per README:
 *   A=Date, B=Amount, C=Project Name, D=(empty), E=For Checking, F=Revised Version, G=Paid
 */
function fetchSheetCSV(sheetName, tabIndex) {
  return new Promise((resolve, reject) => {
    // Build the published CSV URL using the gid (sheet index)
    const gid = CONFIG.GID_MAP[sheetName] !== undefined ? CONFIG.GID_MAP[sheetName] : tabIndex;
    const url = `https://docs.google.com/spreadsheets/d/e/${CONFIG.SHEET_ID}/pub?gid=${gid}&single=true&output=csv`;

    fetch(url)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status} for ${sheetName}`);
        return r.text();
      })
      .then(csv => resolve(parseCSV(csv, sheetName)))
      .catch(reject);
  });
}

/**
 * Parse raw CSV text into project objects.
 * Skips the header row (row 0) and any row without a project name.
 */
function parseCSV(csvText, sheetName) {
  const lines = csvText.trim().split('\n');
  const projects = [];

  // Skip header row (index 0)
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCSVLine(lines[i]);
    if (!cols || cols.length < 3) continue;

    const dateRaw  = clean(cols[0]);  // A: Date
    const amtRaw   = clean(cols[1]);  // B: Amount
    const nameRaw  = clean(cols[2]);  // C: Project Name
    // cols[3] is intentionally skipped (empty column D)
    const checkRaw = clean(cols[4]);  // E: For Checking
    const revisedRaw = clean(cols[5]); // F: Revised Version
    const paidRaw  = clean(cols[6]);  // G: Paid

    // Skip rows with no meaningful content
    if (!nameRaw && !dateRaw) continue;

    // Parse amount — strip currency symbols, commas, spaces
    const amount = parseAmount(amtRaw);

    // Derive month from date string
    const month = extractMonth(dateRaw);

    projects.push({
      date:    dateRaw,
      amount,
      name:    nameRaw || '(Untitled)',
      check:   checkRaw,
      revised: revisedRaw,
      paid:    paidRaw,
      month,
      client:  sheetName,
    });
  }

  return projects;
}

/** Split a CSV line respecting quoted fields */
function splitCSVLine(line) {
  const result = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuote && line[i+1] === '"') { cur += '"'; i++; }
      else inQuote = !inQuote;
    } else if (ch === ',' && !inQuote) {
      result.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  result.push(cur.trim());
  return result;
}

function clean(val) {
  return val ? String(val).trim() : '';
}

function parseAmount(raw) {
  if (!raw) return 0;
  const num = parseFloat(String(raw).replace(/[^0-9.]/g, ''));
  return isNaN(num) ? 0 : num;
}

function extractMonth(dateStr) {
  if (!dateStr) return 'Unknown';
  const s = dateStr.toLowerCase().trim();
  for (let i = 0; i < MONTH_NAMES.length; i++) {
    if (s.includes(MONTH_NAMES[i].toLowerCase())) return MONTH_FULL[i];
  }
  // ISO format: 2024-03-15
  const isoMatch = dateStr.match(/(\d{4})-(\d{2})/);
  if (isoMatch) return MONTH_FULL[parseInt(isoMatch[2], 10) - 1] || 'Unknown';
  // US format: 3/15/2024
  const usMatch = dateStr.match(/^(\d{1,2})\//);
  if (usMatch) {
    const m = parseInt(usMatch[1], 10);
    return (m >= 1 && m <= 12) ? MONTH_FULL[m - 1] : 'Unknown';
  }
  return 'Unknown';
}

// ── METRICS ───────────────────────────────────────────────────────
function calculateMetrics(projects) {
  const total       = projects.length;
  const paidRows    = projects.filter(p => p.paid && p.paid.trim());
  const exported    = projects.filter(p => p.revised && p.revised.trim());
  const needsReview = projects.filter(p => p.check && p.check.trim());
  const completed   = exported; // "Completed" = has a Revised Version

  const totalRevenue   = projects.reduce((s, p) => s + p.amount, 0);
  const paidRevenue    = paidRows.reduce((s, p) => s + p.amount, 0);
  const unpaidRevenue  = totalRevenue - paidRevenue;
  const avgRevenue     = total ? totalRevenue / total : 0;
  const completionRate = total ? (completed.length / total) * 100 : 0;

  return {
    total,
    paid: paidRows.length,
    exported: exported.length,
    needsReview: needsReview.length,
    completed: completed.length,
    totalRevenue,
    paidRevenue,
    unpaidRevenue,
    avgRevenue,
    completionRate,
  };
}

function generateMonthlySummary(projects) {
  const byMonth = {};
  projects.forEach(p => {
    const m = p.month || 'Unknown';
    if (!byMonth[m]) byMonth[m] = [];
    byMonth[m].push(p);
  });
  return Object.entries(byMonth)
    .sort((a, b) => {
      const ai = MONTH_FULL.indexOf(a[0]);
      const bi = MONTH_FULL.indexOf(b[0]);
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
    })
    .map(([month, rows]) => ({ month, ...calculateMetrics(rows) }));
}

// ── DASHBOARD ─────────────────────────────────────────────────────
function renderDashboard() {
  const clientFilter = document.getElementById('clientFilter').value;
  const projects = (!clientFilter || clientFilter === 'all')
    ? state.allProjects
    : state.allProjects.filter(p => p.client === clientFilter);

  const m = calculateMetrics(projects);

  const kpiDef = [
    { label: 'Total Videos',        value: m.total,              cls: '' },
    { label: 'Completed',           value: m.completed,          cls: 'green' },
    { label: 'Awaiting Review',     value: m.needsReview,        cls: 'amber' },
    { label: 'Exported',            value: m.exported,           cls: '' },
    { label: 'Total Revenue',       value: fmt$(m.totalRevenue),  cls: '' },
    { label: 'Paid Revenue',        value: fmt$(m.paidRevenue),   cls: 'green' },
    { label: 'Unpaid Revenue',      value: fmt$(m.unpaidRevenue), cls: 'red' },
    { label: 'Avg Revenue / Video', value: fmt$(m.avgRevenue),    cls: 'blue' },
  ];

  document.getElementById('kpiGrid').innerHTML = kpiDef.map(k => `
    <div class="kpi-card">
      <div class="kpi-label">${k.label}</div>
      <div class="kpi-value ${k.cls}">${k.value}</div>
      ${k.label === 'Completed'
        ? `<div class="kpi-sub">${m.completionRate.toFixed(1)}% completion rate</div>`
        : ''}
    </div>`).join('');

  renderSpotlight(projects, m);
  renderMonthlySummary(projects);
  renderClientCards();
}

function renderSpotlight(projects, m) {
  const byClient = {};
  projects.forEach(p => { byClient[p.client] = (byClient[p.client] || 0) + p.amount; });
  const topClient = Object.entries(byClient).sort((a, b) => b[1] - a[1])[0];

  const byMonth = {};
  projects.forEach(p => { byMonth[p.month] = (byMonth[p.month] || 0) + p.amount; });
  const topMonth = Object.entries(byMonth).sort((a, b) => b[1] - a[1])[0];

  document.getElementById('spotlightRow').innerHTML = `
    <div class="spotlight-card">
      <span class="spotlight-eyebrow">Top Client</span>
      <span class="spotlight-value">${topClient ? topClient[0] : '—'}</span>
      <span class="spotlight-label">${topClient ? fmt$(topClient[1]) + ' total revenue' : 'No data'}</span>
    </div>
    <div class="spotlight-card">
      <span class="spotlight-eyebrow">Best Month</span>
      <span class="spotlight-value">${topMonth ? topMonth[0] : '—'}</span>
      <span class="spotlight-label">${topMonth ? fmt$(topMonth[1]) + ' revenue' : 'No data'}</span>
    </div>
    <div class="spotlight-card">
      <span class="spotlight-eyebrow">Completion Rate</span>
      <span class="spotlight-value">${m.completionRate.toFixed(1)}%</span>
      <span class="spotlight-label">${m.completed} of ${m.total} videos delivered</span>
    </div>
    <div class="spotlight-card">
      <span class="spotlight-eyebrow">Outstanding</span>
      <span class="spotlight-value">${fmt$(m.unpaidRevenue)}</span>
      <span class="spotlight-label">across ${m.total - m.paid} unpaid projects</span>
    </div>`;
}

function renderMonthlySummary(projects) {
  const summaries = generateMonthlySummary(projects);
  const container = document.getElementById('monthlyGrid');
  if (!summaries.length) {
    container.innerHTML = '<div class="empty-state">No data yet.</div>';
    return;
  }
  container.innerHTML = summaries.map(s => `
    <div class="monthly-card">
      <div class="monthly-month">${s.month}</div>
      <div class="monthly-row"><span class="monthly-key">Videos</span><span class="monthly-val">${s.total}</span></div>
      <div class="monthly-row"><span class="monthly-key">Completed</span><span class="monthly-val">${s.completed}</span></div>
      <div class="monthly-row"><span class="monthly-key">Revenue</span><span class="monthly-val">${fmt$(s.totalRevenue)}</span></div>
      <div class="monthly-row"><span class="monthly-key">Paid</span><span class="monthly-val">${fmt$(s.paidRevenue)}</span></div>
      <div class="monthly-row"><span class="monthly-key">Outstanding</span><span class="monthly-val">${fmt$(s.unpaidRevenue)}</span></div>
      <div class="progress-bar-wrap">
        <div class="progress-bar" style="width:${Math.min(100, s.completionRate)}%"></div>
      </div>
    </div>`).join('');
}

function renderClientCards() {
  const cards = CONFIG.TABS.map((tab, i) => {
    const projects = state.allProjects.filter(p => p.client === tab);
    if (!projects.length) return null;
    return { tab, m: calculateMetrics(projects), color: CLIENT_COLORS[i % CLIENT_COLORS.length] };
  }).filter(Boolean);

  document.getElementById('clientGrid').innerHTML = cards.length
    ? cards.map(({ tab, m, color }) => `
      <div class="client-card">
        <div class="client-name">
          <span class="client-dot" style="background:${color}"></span>${escHtml(tab)}
        </div>
        <div class="client-stat"><span class="client-stat-key">Videos</span><span class="client-stat-val">${m.total}</span></div>
        <div class="client-stat"><span class="client-stat-key">Revenue</span><span class="client-stat-val">${fmt$(m.totalRevenue)}</span></div>
        <div class="client-stat"><span class="client-stat-key">Paid</span><span class="client-stat-val">${fmt$(m.paidRevenue)}</span></div>
        <div class="client-stat"><span class="client-stat-key">Completion</span><span class="client-stat-val">${m.completionRate.toFixed(0)}%</span></div>
      </div>`).join('')
    : '<div class="empty-state">No client data.</div>';
}

// ── CHARTS ────────────────────────────────────────────────────────
function renderCharts() {
  const projects = state.allProjects;
  if (!projects.length) return;

  const summaries = generateMonthlySummary(projects);
  const labels = summaries.map(s => s.month.slice(0, 3));

  Chart.defaults.color = '#5a5a5a';
  Chart.defaults.borderColor = '#262626';
  Chart.defaults.font.family = "'Inter', system-ui, sans-serif";

  const baseOptions = (isMoney) => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#1a1a1a', borderColor: '#333', borderWidth: 1,
        titleColor: '#fff', bodyColor: '#9a9a9a', padding: 10, cornerRadius: 8,
        callbacks: isMoney ? { label: ctx => ' $' + ctx.raw.toLocaleString('en-US', { minimumFractionDigits: 2 }) } : {},
      },
    },
    scales: {
      x: { grid: { color: '#1a1a1a' }, ticks: { color: '#5a5a5a', font: { size: 11 } } },
      y: {
        grid: { color: '#1a1a1a' },
        ticks: { color: '#5a5a5a', font: { size: 11 }, callback: v => isMoney ? '$' + v.toLocaleString() : v },
        beginAtZero: true,
      },
    },
  });

  initChart('revenueChart', {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data: summaries.map(s => s.totalRevenue),
        backgroundColor: 'rgba(96,165,250,.18)',
        borderColor: '#60a5fa',
        borderWidth: 1.5,
        borderRadius: 5,
        hoverBackgroundColor: 'rgba(96,165,250,.28)',
      }],
    },
    options: baseOptions(true),
  });

  initChart('videosChart', {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data: summaries.map(s => s.total),
        backgroundColor: 'rgba(167,139,250,.18)',
        borderColor: '#a78bfa',
        borderWidth: 1.5,
        borderRadius: 5,
        hoverBackgroundColor: 'rgba(167,139,250,.28)',
      }],
    },
    options: baseOptions(false),
  });

  const totalRev = projects.reduce((s, p) => s + p.amount, 0);
  const paidRev  = projects.filter(p => p.paid && p.paid.trim()).reduce((s, p) => s + p.amount, 0);

  const doughnutOpts = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: '68%',
    plugins: {
      legend: {
        display: true,
        position: 'bottom',
        labels: { color: '#9a9a9a', padding: 16, font: { size: 12 } },
      },
      tooltip: {
        backgroundColor: '#1a1a1a', borderColor: '#333', borderWidth: 1,
        callbacks: { label: ctx => ' ' + fmt$(ctx.raw) },
      },
    },
  };

  initChart('paidChart', {
    type: 'doughnut',
    data: {
      labels: ['Paid', 'Unpaid'],
      datasets: [{
        data: [paidRev, totalRev - paidRev],
        backgroundColor: ['rgba(34,197,94,.3)', 'rgba(239,68,68,.2)'],
        borderColor: ['#22c55e', '#ef4444'],
        borderWidth: 1.5,
        hoverOffset: 8,
      }],
    },
    options: doughnutOpts,
  });

  const clientData = CONFIG.TABS.map((tab, i) => ({
    tab,
    rev: projects.filter(p => p.client === tab).reduce((s, p) => s + p.amount, 0),
    color: CLIENT_COLORS[i % CLIENT_COLORS.length],
  })).filter(d => d.rev > 0);

  initChart('clientChart', {
    type: 'doughnut',
    data: {
      labels: clientData.map(d => d.tab),
      datasets: [{
        data: clientData.map(d => d.rev),
        backgroundColor: clientData.map(d => d.color + '40'),
        borderColor: clientData.map(d => d.color),
        borderWidth: 1.5,
        hoverOffset: 8,
      }],
    },
    options: {
      ...doughnutOpts,
      cutout: '60%',
      plugins: {
        ...doughnutOpts.plugins,
        legend: {
          display: true,
          position: 'bottom',
          labels: { color: '#9a9a9a', padding: 10, font: { size: 11 }, boxWidth: 10 },
        },
      },
    },
  });
}

function initChart(id, config) {
  if (state.charts[id]) {
    state.charts[id].destroy();
    delete state.charts[id];
  }
  const ctx = document.getElementById(id)?.getContext('2d');
  if (ctx) state.charts[id] = new Chart(ctx, config);
}

// ── TABLE ─────────────────────────────────────────────────────────
function initTable() {
  document.querySelectorAll('.data-table th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.sort;
      if (state.sortCol === col) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
      else { state.sortCol = col; state.sortDir = 'asc'; }
      document.querySelectorAll('.data-table th').forEach(h => h.classList.remove('sort-asc', 'sort-desc'));
      th.classList.add('sort-' + state.sortDir);
      applyFiltersAndRender();
    });
  });

  ['searchInput', 'filterClient', 'filterMonth', 'filterPaid', 'filterStatus'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', () => {
      state.currentPage = 1;
      applyFiltersAndRender();
    });
  });

  document.getElementById('clearFiltersBtn').addEventListener('click', () => {
    ['searchInput', 'filterClient', 'filterMonth', 'filterPaid', 'filterStatus'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    state.currentPage = 1;
    applyFiltersAndRender();
  });

  document.getElementById('exportCsvBtn').addEventListener('click', exportCsv);
}

function buildFilterOptions() {
  const clients = [...new Set(state.allProjects.map(p => p.client))];
  const months  = [...new Set(state.allProjects.map(p => p.month).filter(m => m !== 'Unknown'))].sort((a, b) => {
    const ai = MONTH_FULL.indexOf(a);
    const bi = MONTH_FULL.indexOf(b);
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
  });

  const clientFilter = document.getElementById('clientFilter');
  clientFilter.innerHTML = '<option value="all">All Clients</option>' +
    clients.map(c => `<option value="${escHtml(c)}">${escHtml(c)}</option>`).join('');
  clientFilter.addEventListener('change', () => renderDashboard());

  const fc = document.getElementById('filterClient');
  fc.innerHTML = '<option value="">All Clients</option>' +
    clients.map(c => `<option value="${escHtml(c)}">${escHtml(c)}</option>`).join('');

  const fm = document.getElementById('filterMonth');
  fm.innerHTML = '<option value="">All Months</option>' +
    months.map(m => `<option value="${m}">${m}</option>`).join('');
}

function applyFiltersAndRender() {
  const search = document.getElementById('searchInput')?.value.toLowerCase() || '';
  const client = document.getElementById('filterClient')?.value || '';
  const month  = document.getElementById('filterMonth')?.value || '';
  const paid   = document.getElementById('filterPaid')?.value || '';
  const status = document.getElementById('filterStatus')?.value || '';

  let rows = state.allProjects.slice();

  if (client) rows = rows.filter(r => r.client === client);
  if (month)  rows = rows.filter(r => r.month === month);
  if (paid === 'paid')   rows = rows.filter(r => r.paid && r.paid.trim());
  if (paid === 'unpaid') rows = rows.filter(r => !r.paid || !r.paid.trim());
  if (status === 'completed') rows = rows.filter(r => r.revised && r.revised.trim());
  if (status === 'review')    rows = rows.filter(r => r.check && r.check.trim());
  if (status === 'exported')  rows = rows.filter(r => r.revised && r.revised.trim());

  if (search) {
    rows = rows.filter(r =>
      r.name.toLowerCase().includes(search) ||
      r.client.toLowerCase().includes(search) ||
      r.date.toLowerCase().includes(search)
    );
  }

  rows.sort((a, b) => {
    let av, bv;
    if (state.sortCol === 'amount')      { av = a.amount;  bv = b.amount; }
    else if (state.sortCol === 'client') { av = a.client;  bv = b.client; }
    else if (state.sortCol === 'name')   { av = a.name;    bv = b.name; }
    else                                  { av = a.date;    bv = b.date; }
    if (typeof av === 'number') return state.sortDir === 'asc' ? av - bv : bv - av;
    return state.sortDir === 'asc'
      ? String(av).localeCompare(String(bv))
      : String(bv).localeCompare(String(av));
  });

  state.filtered = rows;
  renderTable();
  renderPagination();
}

function renderTable() {
  const start = (state.currentPage - 1) * CONFIG.ROWS_PER_PAGE;
  const page  = state.filtered.slice(start, start + CONFIG.ROWS_PER_PAGE);
  const tbody = document.getElementById('projectTableBody');

  if (!page.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="table-loading">No projects match your filters.</td></tr>`;
    return;
  }

  tbody.innerHTML = page.map(r => {
    const isPaid     = r.paid && r.paid.trim();
    const isExported = r.revised && r.revised.trim();
    const hasReview  = r.check && r.check.trim();

    const statusBadge = isExported
      ? `<span class="badge badge-completed">Completed</span>`
      : hasReview
        ? `<span class="badge badge-review">In Review</span>`
        : `<span class="badge badge-pending">Pending</span>`;

    const payBadge = isPaid
      ? `<span class="badge badge-paid">${escHtml(r.paid)}</span>`
      : `<span class="badge badge-unpaid">Unpaid</span>`;

    return `<tr>
      <td class="td-date">${escHtml(r.date)}</td>
      <td class="td-client">${escHtml(r.client)}</td>
      <td class="td-name">${escHtml(r.name)}</td>
      <td class="td-amount">${r.amount ? fmt$(r.amount) : '—'}</td>
      <td>${hasReview
        ? `<span class="badge badge-review">${escHtml(r.check)}</span>`
        : '<span style="color:var(--text-3)">—</span>'}</td>
      <td>${isExported
        ? `<span class="badge badge-exported" title="${escHtml(r.revised)}">Exported</span>`
        : '<span style="color:var(--text-3)">—</span>'}</td>
      <td>${payBadge}</td>
      <td>${statusBadge}</td>
    </tr>`;
  }).join('');
}

function renderPagination() {
  const total = Math.ceil(state.filtered.length / CONFIG.ROWS_PER_PAGE);
  const cur   = state.currentPage;
  const container = document.getElementById('pagination');
  if (total <= 1) { container.innerHTML = ''; return; }

  let html = `<button class="page-btn" ${cur <= 1 ? 'disabled' : ''} data-p="${cur - 1}">‹</button>`;
  paginationRange(cur, total).forEach(p => {
    if (p === '…') html += `<span class="page-info">…</span>`;
    else html += `<button class="page-btn ${p === cur ? 'active' : ''}" data-p="${p}">${p}</button>`;
  });
  html += `<button class="page-btn" ${cur >= total ? 'disabled' : ''} data-p="${cur + 1}">›</button>`;
  html += `<span class="page-info">${state.filtered.length} results</span>`;

  container.innerHTML = html;
  container.querySelectorAll('.page-btn:not(:disabled)').forEach(btn => {
    btn.addEventListener('click', () => {
      state.currentPage = parseInt(btn.dataset.p, 10);
      applyFiltersAndRender();
    });
  });
}

function paginationRange(cur, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set([1, total, cur, cur - 1, cur + 1].filter(p => p >= 1 && p <= total));
  const sorted = [...pages].sort((a, b) => a - b);
  const result = []; let prev = 0;
  sorted.forEach(p => { if (p - prev > 1) result.push('…'); result.push(p); prev = p; });
  return result;
}

// ── CSV EXPORT ────────────────────────────────────────────────────
function exportCsv() {
  const rows = state.filtered;
  if (!rows.length) { showToast('No data to export.'); return; }

  const headers = ['Date', 'Client', 'Project Name', 'Amount', 'Review', 'Revised', 'Paid'];
  const lines = [
    headers.join(','),
    ...rows.map(r => [
      csvField(r.date), csvField(r.client), csvField(r.name),
      r.amount ? r.amount.toFixed(2) : '',
      csvField(r.check), csvField(r.revised), csvField(r.paid),
    ].join(',')),
  ];

  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), {
    href: url,
    download: `dc-projects-${dateStamp()}.csv`,
  });
  a.click();
  URL.revokeObjectURL(url);
  showToast('Exported ' + rows.length + ' rows.');
}

// ── UTILITIES ─────────────────────────────────────────────────────
function fmt$(n) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function csvField(val) {
  if (!val) return '';
  const s = String(val).replace(/"/g, '""');
  return (s.includes(',') || s.includes('"') || s.includes('\n')) ? `"${s}"` : s;
}

function dateStamp() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 3000);
}
