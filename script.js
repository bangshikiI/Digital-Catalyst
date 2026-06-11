/* ================================================================
   Digital Catalyst — Production Tracker
   script.js
   ================================================================ */

'use strict';

const CONFIG = {
  SHEET_ID: '1mqll7u7E03w_cbUTb6lKR1EjoepupjjFrHxHLNltUBk',
  TABS: ['DC', 'Jeya', 'L&S', 'LHF', 'Boney', 'Aida', 'AMmarket', 'Chef', 'Goreng', 'Mavi', 'Saddam'],
  ROWS_PER_PAGE: 25,
};

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

// ── COLUMN MAP ────────────────────────────────────────────────────
// The Google Visualization API skips completely-empty physical columns
// and re-indexes from 0. The map below reflects the GVIZ index for each
// key field, derived from the actual sheet layout.
//
//  DC:        gviz[0]=Date  [1]=Amount  [2]=Name  [3]=ForChecking  [4]=Revised  [5]=Paid
//  Chef:      gviz[0]=Date  [1]=Amount  [2]=Name  [3]=ToReview  [4]=Check1  [5]=Check2  [6]=<filename>  [7]=Paid  [8]=Revised
//  All others:gviz[0]=Date  [1]=Amount  [2]=Name  [3]=ToReview  [4]=Check1  [5]=Check2  [6]=Revised  [7]=Paid
//
// "check" = the To Review / For Checking field (col with links or notes sent to client)
// "revised" = the Revised Version / exported filename
// "paid" = payment date column

const COL_LAYOUT = {
  DC:  { check: 3, revised: 4, paid: 5 },
  Chef:{ check: 3, revised: 8, paid: 7 },
};
const COL_DEFAULT = { check: 3, revised: 6, paid: 7 };

function getLayout(sheetName) {
  return COL_LAYOUT[sheetName] || COL_DEFAULT;
}

// ── ENTRY POINT ───────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initNav();
  initTable();
  loadAllData();
  setInterval(loadAllData, 60000);
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
    CONFIG.TABS.map(tab => fetchSheetData(tab))
  );

  const allRows = [];
  results.forEach((result, i) => {
    if (result.status === 'fulfilled' && result.value.length) {
      result.value.forEach(row => allRows.push({ ...row, client: CONFIG.TABS[i] }));
    } else if (result.status === 'rejected') {
      console.warn('Failed tab:', CONFIG.TABS[i], result.reason);
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
  if (document.getElementById('page-analytics').classList.contains('active')) renderCharts();
  applyFiltersAndRender();
}

function showSkeletons() {
  document.getElementById('kpiGrid').innerHTML = Array(8).fill(`
    <div class="kpi-card skeleton"><div class="kpi-shimmer"></div></div>
  `).join('');
}

function showError() {
  document.getElementById('kpiGrid').innerHTML = `
    <div class="error-banner">
      <div class="error-icon">⚠️</div>
      <div class="error-title">Could not load sheet data</div>
      <div class="error-body">
        Make sure the Google Sheet is shared as <strong>Anyone with the link → Viewer</strong>.<br><br>
        In Google Sheets: <em>Share → Change to anyone with the link → Viewer → Done</em>
      </div>
    </div>`;
  document.getElementById('monthlyGrid').innerHTML = '';
  document.getElementById('clientGrid').innerHTML = '';
  document.getElementById('spotlightRow').innerHTML = '';
  document.getElementById('projectTableBody').innerHTML =
    '<tr><td colspan="8" class="table-loading">Sheet not accessible.</td></tr>';
}

// ── FETCH via Google Visualization API (JSONP, no API key needed) ──
function fetchSheetData(sheetName) {
  return new Promise((resolve, reject) => {
    const cbName = '_gviz_' + sheetName.replace(/[^a-zA-Z0-9]/g, '_') + '_' + Date.now();
    const url = `https://docs.google.com/spreadsheets/d/${CONFIG.SHEET_ID}/gviz/tq?sheet=${encodeURIComponent(sheetName)}&tqx=out:json;responseHandler:${cbName}`;

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Timeout: ' + sheetName));
    }, 15000);

    window[cbName] = (data) => {
      cleanup();
      try {
        resolve(parseGvizData(data, sheetName));
      } catch (err) {
        reject(err);
      }
    };

    const script = document.createElement('script');
    script.onerror = () => { cleanup(); reject(new Error('Load failed: ' + sheetName)); };
    script.src = url;
    document.head.appendChild(script);

    function cleanup() {
      clearTimeout(timer);
      delete window[cbName];
      if (script.parentNode) script.parentNode.removeChild(script);
    }
  });
}

// ── PARSE GVIZ RESPONSE ───────────────────────────────────────────
// The gviz API skips completely-empty physical columns and re-indexes.
// Column indices used here are GVIZ indices (post-skip), not physical.
//
// All tabs share the same logical fields; only the gviz index differs
// per tab (see COL_LAYOUT / COL_DEFAULT above).
//
// Paid column: gviz returns dates as { v: "Date(2026,0,17)", f: "Jan 17, 2026" }
//              or sometimes as a raw number string for older exports.
// Revised/Check columns: boolean TRUE/FALSE cells come in as boolean v,
//              filename strings come in as string v.

function parseGvizData(data, sheetName) {
  const rows = data && data.table && data.table.rows;
  if (!rows || !rows.length) return [];

  const layout = getLayout(sheetName);
  const projects = [];

  rows.forEach(row => {
    if (!row || !row.c) return;

    // Safe cell accessor — returns { v, f } or null
    const getCell = (i) => {
      if (!row.c || i >= row.c.length) return null;
      return row.c[i] || null;
    };

    // Get display string from a cell
    const cellStr = (i) => {
      const c = getCell(i);
      if (!c || c.v === null || c.v === undefined) return '';
      // Prefer formatted value (human-readable) over raw
      const val = (c.f !== undefined && c.f !== null) ? c.f : c.v;
      return String(val).trim();
    };

    // Get raw value (for booleans)
    const cellRaw = (i) => {
      const c = getCell(i);
      return c ? c.v : null;
    };

    const dateRaw    = cellStr(0);
    const amtRaw     = cellStr(1);
    const nameRaw    = cellStr(2);
    const checkRaw   = cellRaw(layout.check);
    const revisedRaw = cellRaw(layout.revised);
    const paidCell   = getCell(layout.paid);

    // Skip blank rows and header row
    if (!nameRaw && !dateRaw) return;
    const nameLower = nameRaw.toLowerCase();
    const dateLower = dateRaw.toLowerCase();
    if (nameLower === 'project name:' || nameLower === 'project name' ||
        dateLower === 'date:' || dateLower === 'date' ||
        nameLower === 'total:' || dateLower === 'total:') return;

    const amount = parseAmount(amtRaw);
    const month  = extractMonth(dateRaw);

    // Resolve "revised" — true if the cell is boolean true OR has a filename string
    const isRevised = resolveBoolean(revisedRaw);

    // Resolve "check" — true if the cell has any content (URL, text, TRUE)
    const isChecked = resolveBoolean(checkRaw);

    // Paid: gviz returns dates with a formatted value like "Jan 17, 2026"
    let paidDisplay = '';
    if (paidCell && paidCell.v !== null && paidCell.v !== undefined) {
      if (paidCell.f) {
        paidDisplay = String(paidCell.f).trim();
      } else {
        const raw = String(paidCell.v).trim();
        // gviz date value format: "Date(2026,0,17)"
        const m = raw.match(/^Date\((\d+),(\d+),(\d+)\)/);
        if (m) {
          const d = new Date(Date.UTC(+m[1], +m[2], +m[3]));
          paidDisplay = d.toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric', timeZone:'UTC' });
        } else if (raw && raw !== 'false' && raw !== 'FALSE' && raw !== '0') {
          paidDisplay = raw;
        }
      }
    }

    projects.push({
      date:    dateRaw,
      amount,
      name:    nameRaw || '(Untitled)',
      check:   isChecked,
      revised: isRevised,
      paid:    paidDisplay,
      month,
      client:  sheetName,
    });
  });

  return projects;
}

// Resolve a raw cell value to boolean
// TRUE (bool), truthy string (non-empty, not "false"/"FALSE") → true
// FALSE (bool), null, empty, "FALSE" → false
function resolveBoolean(v) {
  if (v === null || v === undefined) return false;
  if (typeof v === 'boolean') return v;
  const s = String(v).trim().toUpperCase();
  return s !== '' && s !== 'FALSE' && s !== '0' && s !== 'NONE';
}

function parseAmount(raw) {
  if (!raw) return 0;
  const num = parseFloat(String(raw).replace(/[^0-9.]/g, ''));
  return isNaN(num) ? 0 : num;
}

function extractMonth(dateStr) {
  if (!dateStr) return 'Unknown';
  const s = dateStr.toLowerCase();
  for (let i = 0; i < MONTH_NAMES.length; i++) {
    if (s.includes(MONTH_NAMES[i].toLowerCase())) return MONTH_FULL[i];
  }
  const isoMatch = dateStr.match(/(\d{4})-(\d{2})/);
  if (isoMatch) return MONTH_FULL[parseInt(isoMatch[2], 10) - 1] || 'Unknown';
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
  const exported    = projects.filter(p => p.revised);
  const needsReview = projects.filter(p => p.check);
  const completed   = exported;

  const totalRevenue   = projects.reduce((s, p) => s + p.amount, 0);
  const paidRevenue    = paidRows.reduce((s, p) => s + p.amount, 0);
  const unpaidRevenue  = totalRevenue - paidRevenue;
  const avgRevenue     = total ? totalRevenue / total : 0;
  const completionRate = total ? (completed.length / total) * 100 : 0;

  return {
    total, paid: paidRows.length, exported: exported.length,
    needsReview: needsReview.length, completed: completed.length,
    totalRevenue, paidRevenue, unpaidRevenue, avgRevenue, completionRate,
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
      const ai = MONTH_FULL.indexOf(a[0]), bi = MONTH_FULL.indexOf(b[0]);
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
      ${k.label === 'Completed' ? `<div class="kpi-sub">${m.completionRate.toFixed(1)}% completion rate</div>` : ''}
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
  if (!summaries.length) { container.innerHTML = '<div class="empty-state">No data yet.</div>'; return; }
  container.innerHTML = summaries.map(s => `
    <div class="monthly-card">
      <div class="monthly-month">${s.month}</div>
      <div class="monthly-row"><span class="monthly-key">Videos</span><span class="monthly-val">${s.total}</span></div>
      <div class="monthly-row"><span class="monthly-key">Completed</span><span class="monthly-val">${s.completed}</span></div>
      <div class="monthly-row"><span class="monthly-key">Revenue</span><span class="monthly-val">${fmt$(s.totalRevenue)}</span></div>
      <div class="monthly-row"><span class="monthly-key">Paid</span><span class="monthly-val">${fmt$(s.paidRevenue)}</span></div>
      <div class="monthly-row"><span class="monthly-key">Outstanding</span><span class="monthly-val">${fmt$(s.unpaidRevenue)}</span></div>
      <div class="progress-bar-wrap"><div class="progress-bar" style="width:${Math.min(100, s.completionRate)}%"></div></div>
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
        <div class="client-name"><span class="client-dot" style="background:${color}"></span>${escHtml(tab)}</div>
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
    responsive: true, maintainAspectRatio: false,
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
      y: { grid: { color: '#1a1a1a' }, ticks: { color: '#5a5a5a', font: { size: 11 }, callback: v => isMoney ? '$' + v.toLocaleString() : v }, beginAtZero: true },
    },
  });

  initChart('revenueChart', { type: 'bar', data: { labels, datasets: [{ data: summaries.map(s => s.totalRevenue), backgroundColor: 'rgba(96,165,250,.18)', borderColor: '#60a5fa', borderWidth: 1.5, borderRadius: 5, hoverBackgroundColor: 'rgba(96,165,250,.28)' }] }, options: baseOptions(true) });
  initChart('videosChart',  { type: 'bar', data: { labels, datasets: [{ data: summaries.map(s => s.total),        backgroundColor: 'rgba(167,139,250,.18)', borderColor: '#a78bfa', borderWidth: 1.5, borderRadius: 5, hoverBackgroundColor: 'rgba(167,139,250,.28)' }] }, options: baseOptions(false) });

  const totalRev = projects.reduce((s, p) => s + p.amount, 0);
  const paidRev  = projects.filter(p => p.paid && p.paid.trim()).reduce((s, p) => s + p.amount, 0);
  const doughnutOpts = {
    responsive: true, maintainAspectRatio: false, cutout: '68%',
    plugins: {
      legend: { display: true, position: 'bottom', labels: { color: '#9a9a9a', padding: 16, font: { size: 12 } } },
      tooltip: { backgroundColor: '#1a1a1a', borderColor: '#333', borderWidth: 1, callbacks: { label: ctx => ' ' + fmt$(ctx.raw) } },
    },
  };

  initChart('paidChart', { type: 'doughnut', data: { labels: ['Paid', 'Unpaid'], datasets: [{ data: [paidRev, totalRev - paidRev], backgroundColor: ['rgba(34,197,94,.3)', 'rgba(239,68,68,.2)'], borderColor: ['#22c55e', '#ef4444'], borderWidth: 1.5, hoverOffset: 8 }] }, options: doughnutOpts });

  const clientData = CONFIG.TABS.map((tab, i) => ({
    tab, rev: projects.filter(p => p.client === tab).reduce((s, p) => s + p.amount, 0), color: CLIENT_COLORS[i % CLIENT_COLORS.length]
  })).filter(d => d.rev > 0);

  initChart('clientChart', { type: 'doughnut', data: { labels: clientData.map(d => d.tab), datasets: [{ data: clientData.map(d => d.rev), backgroundColor: clientData.map(d => d.color + '40'), borderColor: clientData.map(d => d.color), borderWidth: 1.5, hoverOffset: 8 }] },
    options: { ...doughnutOpts, cutout: '60%', plugins: { ...doughnutOpts.plugins, legend: { display: true, position: 'bottom', labels: { color: '#9a9a9a', padding: 10, font: { size: 11 }, boxWidth: 10 } } } } });
}

function initChart(id, config) {
  if (state.charts[id]) { state.charts[id].destroy(); delete state.charts[id]; }
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
    document.getElementById(id)?.addEventListener('input', () => { state.currentPage = 1; applyFiltersAndRender(); });
  });

  document.getElementById('clearFiltersBtn').addEventListener('click', () => {
    ['searchInput', 'filterClient', 'filterMonth', 'filterPaid', 'filterStatus'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
    state.currentPage = 1; applyFiltersAndRender();
  });

  document.getElementById('exportCsvBtn').addEventListener('click', exportCsv);
}

function buildFilterOptions() {
  const clients = [...new Set(state.allProjects.map(p => p.client))];
  const months  = [...new Set(state.allProjects.map(p => p.month).filter(m => m !== 'Unknown'))].sort((a, b) => {
    const ai = MONTH_FULL.indexOf(a), bi = MONTH_FULL.indexOf(b);
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
  });

  const clientFilter = document.getElementById('clientFilter');
  clientFilter.innerHTML = '<option value="all">All Clients</option>' + clients.map(c => `<option value="${escHtml(c)}">${escHtml(c)}</option>`).join('');
  clientFilter.addEventListener('change', () => renderDashboard());

  document.getElementById('filterClient').innerHTML = '<option value="">All Clients</option>' + clients.map(c => `<option value="${escHtml(c)}">${escHtml(c)}</option>`).join('');
  document.getElementById('filterMonth').innerHTML  = '<option value="">All Months</option>'  + months.map(m => `<option value="${m}">${m}</option>`).join('');
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
  if (status === 'completed' || status === 'exported') rows = rows.filter(r => r.revised);
  if (status === 'review') rows = rows.filter(r => r.check);
  if (search) rows = rows.filter(r =>
    r.name.toLowerCase().includes(search) ||
    r.client.toLowerCase().includes(search) ||
    r.date.toLowerCase().includes(search)
  );

  rows.sort((a, b) => {
    let av, bv;
    if (state.sortCol === 'amount')      { av = a.amount; bv = b.amount; }
    else if (state.sortCol === 'client') { av = a.client; bv = b.client; }
    else if (state.sortCol === 'name')   { av = a.name;   bv = b.name; }
    else                                  { av = a.date;   bv = b.date; }
    if (typeof av === 'number') return state.sortDir === 'asc' ? av - bv : bv - av;
    return state.sortDir === 'asc' ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
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
    const isExported = r.revised;
    const hasReview  = r.check;
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
      <td>${hasReview  ? `<span class="badge badge-review">✓</span>`    : '<span style="color:var(--text-3)">—</span>'}</td>
      <td>${isExported ? `<span class="badge badge-exported">Exported</span>` : '<span style="color:var(--text-3)">—</span>'}</td>
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
    btn.addEventListener('click', () => { state.currentPage = parseInt(btn.dataset.p, 10); applyFiltersAndRender(); });
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
  const lines = [headers.join(','), ...rows.map(r => [
    csvField(r.date), csvField(r.client), csvField(r.name),
    r.amount ? r.amount.toFixed(2) : '',
    r.check ? 'TRUE' : '', r.revised ? 'TRUE' : '', csvField(r.paid),
  ].join(','))];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: `dc-projects-${dateStamp()}.csv` });
  a.click(); URL.revokeObjectURL(url);
  showToast('Exported ' + rows.length + ' rows.');
}

// ── UTILITIES ─────────────────────────────────────────────────────
function fmt$(n) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function csvField(val) {
  if (!val) return '';
  const s = String(val).replace(/"/g, '""');
  return (s.includes(',') || s.includes('"') || s.includes('\n')) ? `"${s}"` : s;
}
function dateStamp() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
}
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(t._timer); t._timer = setTimeout(() => t.classList.remove('show'), 3000);
}
