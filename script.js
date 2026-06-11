/* ================================================================
   Digital Catalyst — Production Tracker
   script.js — Data fetching, parsing, rendering, interactions
   ================================================================ */

'use strict';

// ── CONFIG ───────────────────────────────────────────────────────
const CONFIG = {
  SHEET_ID: '1mqll7u7E03w_cbUTb6lKR1EjoepupjjFrHxHLNltUBk',
  // All sheet tabs to fetch
  TABS: ['DC', 'Jeya', 'L&S', 'LHF', 'Boney', 'Aida', 'AMmarket', 'Chef', 'Goreng', 'Mavi', 'Saddam'],
  ROWS_PER_PAGE: 25,
};

// ── STATE ─────────────────────────────────────────────────────────
const state = {
  allProjects: [],      // flat array of all parsed project rows
  filtered: [],         // after applying filters
  currentPage: 1,
  sortCol: 'date',
  sortDir: 'desc',
  charts: {},           // chart instances keyed by id
  lastSync: null,
};

// ── MONTH ORDER ───────────────────────────────────────────────────
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTH_FULL  = ['January','February','March','April','May','June','July','August','September','October','November','December'];

// Client accent colors (cycling)
const CLIENT_COLORS = [
  '#60a5fa','#a78bfa','#34d399','#f59e0b','#f87171',
  '#38bdf8','#fb923c','#c084fc','#4ade80','#e879f9',
  '#facc15',
];

// ── ENTRY POINT ───────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initNav();
  initFilters();
  initTable();
  loadAllData();
});

// ── NAVIGATION ───────────────────────────────────────────────────
function initNav() {
  const links    = document.querySelectorAll('.nav-link');
  const pages    = document.querySelectorAll('.page');
  const hamburger = document.getElementById('hamburger');
  const navLinks  = document.getElementById('navLinks');
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

      // Lazy-render charts when analytics tab opens
      if (target === 'analytics' && state.allProjects.length) {
        renderCharts();
      }
    });
  });

  hamburger.addEventListener('click', () => navLinks.classList.toggle('open'));

  refreshBtn.addEventListener('click', () => {
    refreshBtn.classList.add('spinning');
    loadAllData().finally(() => refreshBtn.classList.remove('spinning'));
  });
}

// ── DATA LOADING ──────────────────────────────────────────────────

/**
 * Fetch data for all configured tabs concurrently, merge, and render.
 */
async function loadAllData() {
  const results = await Promise.allSettled(
    CONFIG.TABS.map(tab => fetchSheetData(tab))
  );

  const allRows = [];
  results.forEach((result, i) => {
    if (result.status === 'fulfilled' && result.value.length) {
      result.value.forEach(row => {
        allRows.push({ ...row, client: CONFIG.TABS[i] });
      });
    }
  });

  if (!allRows.length) {
    showToast('No data found — check the sheet is publicly shared.');
    return;
  }

  state.allProjects = allRows;
  state.lastSync = new Date();
  document.getElementById('syncLabel').textContent =
    'Synced ' + state.lastSync.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  buildFilterOptions();
  renderDashboard();

  // Refresh charts if analytics page is active
  const analyticsActive = document.getElementById('page-analytics').classList.contains('active');
  if (analyticsActive) renderCharts();

  applyFiltersAndRender();
}

/**
 * Fetch a single sheet tab via Google Visualization API (no API key needed).
 * @param {string} sheetName
 * @returns {Promise<Array>}
 */
function fetchSheetData(sheetName) {
  return new Promise((resolve, reject) => {
    const encodedName = encodeURIComponent(sheetName);
    const url = `https://docs.google.com/spreadsheets/d/${CONFIG.SHEET_ID}/gviz/tq?sheet=${encodedName}&tqx=out:json`;
    const cbName = `__gvizCb_${sheetName.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}`;

    const script = document.createElement('script');
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Timeout fetching ' + sheetName));
    }, 12000);

    window[cbName] = (data) => {
      cleanup();
      try { resolve(parseData(data, sheetName)); }
      catch (err) { reject(err); }
    };

    function cleanup() {
      clearTimeout(timer);
      delete window[cbName];
      if (script.parentNode) script.parentNode.removeChild(script);
    }

    script.onerror = () => { cleanup(); reject(new Error('Failed to load ' + sheetName)); };
    script.src = url + `&tqx=out:json;responseHandler:${cbName}`;
    document.head.appendChild(script);
  });
}

/**
 * Parse Google Visualization API response into plain objects.
 * Column layout per sheet: A=DATE, B=Amount, C=Project Name, D=empty, E=For Checking, F=Revised Version, G=Paid
 */
function parseData(gvizData, sheetName) {
  const rows = [];
  if (!gvizData?.table?.rows) return rows;

  const cols = gvizData.table.cols || [];

  gvizData.table.rows.forEach((row) => {
    const cells = row.c || [];
    const getCellValue = (idx) => {
      const cell = cells[idx];
      if (!cell) return '';
      return cell.f ?? (cell.v !== null && cell.v !== undefined ? String(cell.v) : '');
    };

    const dateVal   = getCellValue(0);
    const amountVal = getCellValue(1);
    const nameVal   = getCellValue(2);
    // col D = index 3 is empty/merged column
    const checkVal  = getCellValue(4);  // For Checking / To Review
    const revisedVal= getCellValue(5);  // Revised Version
    const paidVal   = getCellValue(6);  // Paid

    // Skip header rows or empty rows
    if (!nameVal || nameVal.toLowerCase().startsWith('project') || nameVal.toLowerCase() === 'project name') return;
    if (!dateVal && !amountVal && !nameVal) return;
    if (dateVal.toLowerCase().includes('total') || dateVal.toLowerCase().includes('date')) return;

    // Parse amount — strip $, commas, spaces
    const rawAmt = amountVal.replace(/[$,\s]/g, '');
    const amount = parseFloat(rawAmt) || 0;

    // Parse month from date string (e.g. "Jan - video 1", "Feb 5", "2024-02-05", "2/5/2024")
    const month = extractMonth(dateVal);

    rows.push({
      date:     dateVal,
      amount,
      name:     nameVal,
      check:    checkVal,    // To Review / For Checking
      revised:  revisedVal,  // Revised Version (Check 1 equivalent)
      paid:     paidVal,     // Paid date or empty
      client:   sheetName,
      month,
    });
  });

  return rows;
}

/**
 * Extract a normalized month label (e.g. "January", "February") from a date string.
 */
function extractMonth(dateStr) {
  if (!dateStr) return 'Unknown';
  const s = dateStr.toLowerCase().trim();

  for (let i = 0; i < MONTH_NAMES.length; i++) {
    if (s.startsWith(MONTH_NAMES[i].toLowerCase())) return MONTH_FULL[i];
  }

  // Try "YYYY-MM-DD" or "M/D/YYYY"
  const isoMatch = dateStr.match(/(\d{4})-(\d{2})/);
  if (isoMatch) return MONTH_FULL[parseInt(isoMatch[2], 10) - 1] || 'Unknown';

  const usMatch = dateStr.match(/^(\d{1,2})\/\d/);
  if (usMatch) return MONTH_FULL[parseInt(usMatch[1], 10) - 1] || 'Unknown';

  return 'Unknown';
}

// ── METRICS ──────────────────────────────────────────────────────

/**
 * Compute aggregate KPIs from a project array.
 */
function calculateMetrics(projects) {
  const total = projects.length;
  const paid = projects.filter(p => p.paid && p.paid.trim() !== '');
  const exported = projects.filter(p => p.revised && p.revised.trim() !== '');
  const needsReview = projects.filter(p => p.check && p.check.trim() !== '');
  const completed = projects.filter(p => p.revised && p.revised.trim() !== '');

  const totalRevenue  = projects.reduce((s, p) => s + p.amount, 0);
  const paidRevenue   = paid.reduce((s, p) => s + p.amount, 0);
  const unpaidRevenue = totalRevenue - paidRevenue;
  const avgRevenue    = total ? totalRevenue / total : 0;
  const completionRate = total ? (completed.length / total) * 100 : 0;

  return {
    total, paid: paid.length, exported: exported.length,
    needsReview: needsReview.length, completed: completed.length,
    totalRevenue, paidRevenue, unpaidRevenue, avgRevenue, completionRate,
  };
}

/**
 * Build monthly summary objects from project data.
 */
function generateMonthlySummary(projects) {
  const byMonth = {};

  projects.forEach(p => {
    const m = p.month || 'Unknown';
    if (!byMonth[m]) byMonth[m] = [];
    byMonth[m].push(p);
  });

  // Sort by natural month order
  const sorted = Object.entries(byMonth).sort((a, b) => {
    const ai = MONTH_FULL.indexOf(a[0]);
    const bi = MONTH_FULL.indexOf(b[0]);
    if (ai === -1 && bi === -1) return 0;
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

  return sorted.map(([month, rows]) => {
    const metrics = calculateMetrics(rows);
    return { month, ...metrics };
  });
}

// ── DASHBOARD RENDER ──────────────────────────────────────────────

/**
 * Render the full dashboard (KPIs, spotlight, monthly, clients).
 */
function renderDashboard() {
  const clientFilter = document.getElementById('clientFilter').value;
  const projects = clientFilter === 'all' || !clientFilter
    ? state.allProjects
    : state.allProjects.filter(p => p.client === clientFilter);

  const m = calculateMetrics(projects);

  // KPI cards
  const kpiDef = [
    { label: 'Total Videos',          value: m.total,                            cls: '' },
    { label: 'Completed',             value: m.completed,                        cls: 'green' },
    { label: 'Awaiting Review',       value: m.needsReview,                      cls: 'amber' },
    { label: 'Exported',              value: m.exported,                         cls: '' },
    { label: 'Total Revenue',         value: fmt$(m.totalRevenue),               cls: '' },
    { label: 'Paid Revenue',          value: fmt$(m.paidRevenue),                cls: 'green' },
    { label: 'Unpaid Revenue',        value: fmt$(m.unpaidRevenue),              cls: 'red' },
    { label: 'Avg Revenue / Video',   value: fmt$(m.avgRevenue),                 cls: 'blue' },
  ];

  document.getElementById('kpiGrid').innerHTML = kpiDef.map(k => `
    <div class="kpi-card">
      <div class="kpi-label">${k.label}</div>
      <div class="kpi-value ${k.cls}">${k.value}</div>
      ${k.label === 'Completed' ? `<div class="kpi-sub">${m.completionRate.toFixed(1)}% completion rate</div>` : ''}
    </div>
  `).join('');

  // Spotlight
  renderSpotlight(projects, m);

  // Monthly
  renderMonthlySummary(projects);

  // Clients
  renderClientCards();
}

function renderSpotlight(projects, m) {
  // Top earning client
  const byClient = {};
  projects.forEach(p => {
    byClient[p.client] = (byClient[p.client] || 0) + p.amount;
  });
  const topClient = Object.entries(byClient).sort((a,b) => b[1]-a[1])[0];

  // Best month
  const byMonth = {};
  projects.forEach(p => {
    byMonth[p.month] = (byMonth[p.month] || 0) + p.amount;
  });
  const topMonth = Object.entries(byMonth).sort((a,b) => b[1]-a[1])[0];

  // Most recent
  const recentClients = [...new Set(projects.slice(-5).map(p => p.client))];

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
      <span class="spotlight-eyebrow">Outstanding Balance</span>
      <span class="spotlight-value">${fmt$(m.unpaidRevenue)}</span>
      <span class="spotlight-label">across ${m.total - m.paid} unpaid projects</span>
    </div>
  `;
}

function renderMonthlySummary(projects) {
  const summaries = generateMonthlySummary(projects);
  const container = document.getElementById('monthlyGrid');

  if (!summaries.length) {
    container.innerHTML = '<div class="empty-state">No monthly data available.</div>';
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
      <div class="progress-bar-wrap"><div class="progress-bar" style="width:${Math.min(100, s.completionRate)}%"></div></div>
    </div>
  `).join('');
}

function renderClientCards() {
  const container = document.getElementById('clientGrid');
  const cards = CONFIG.TABS.map((tab, i) => {
    const projects = state.allProjects.filter(p => p.client === tab);
    if (!projects.length) return null;
    const m = calculateMetrics(projects);
    const color = CLIENT_COLORS[i % CLIENT_COLORS.length];
    return { tab, m, color };
  }).filter(Boolean);

  if (!cards.length) {
    container.innerHTML = '<div class="empty-state">No client data.</div>';
    return;
  }

  container.innerHTML = cards.map(({ tab, m, color }) => `
    <div class="client-card">
      <div class="client-name">
        <span class="client-dot" style="background:${color}"></span>
        ${tab}
      </div>
      <div class="client-stat"><span class="client-stat-key">Videos</span><span class="client-stat-val">${m.total}</span></div>
      <div class="client-stat"><span class="client-stat-key">Revenue</span><span class="client-stat-val">${fmt$(m.totalRevenue)}</span></div>
      <div class="client-stat"><span class="client-stat-key">Paid</span><span class="client-stat-val">${fmt$(m.paidRevenue)}</span></div>
      <div class="client-stat"><span class="client-stat-key">Completion</span><span class="client-stat-val">${m.completionRate.toFixed(0)}%</span></div>
    </div>
  `).join('');
}

// ── CHARTS ────────────────────────────────────────────────────────

/**
 * Render all analytics charts using Chart.js.
 */
function renderCharts() {
  const projects = state.allProjects;
  const summaries = generateMonthlySummary(projects);

  const labels = summaries.map(s => s.month.slice(0, 3));
  const revenues = summaries.map(s => s.totalRevenue);
  const videoCounts = summaries.map(s => s.total);

  // Shared chart defaults
  Chart.defaults.color = '#5a5a5a';
  Chart.defaults.borderColor = '#262626';
  Chart.defaults.font.family = "'Inter', system-ui, sans-serif";

  const chartOptions = (yLabel) => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#1a1a1a',
        borderColor: '#333',
        borderWidth: 1,
        titleColor: '#fff',
        bodyColor: '#9a9a9a',
        padding: 10,
        cornerRadius: 8,
      },
    },
    scales: {
      x: { grid: { color: '#1a1a1a' }, ticks: { color: '#5a5a5a', font: { size: 11 } } },
      y: {
        grid: { color: '#1a1a1a' },
        ticks: { color: '#5a5a5a', font: { size: 11 }, callback: v => yLabel === '$' ? '$' + v : v },
        beginAtZero: true,
      },
    },
  });

  // Revenue by month
  initChart('revenueChart', {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data: revenues,
        backgroundColor: 'rgba(96,165,250,.18)',
        borderColor: '#60a5fa',
        borderWidth: 1.5,
        borderRadius: 5,
        hoverBackgroundColor: 'rgba(96,165,250,.28)',
      }],
    },
    options: { ...chartOptions('$') },
  });

  // Videos by month
  initChart('videosChart', {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data: videoCounts,
        backgroundColor: 'rgba(167,139,250,.18)',
        borderColor: '#a78bfa',
        borderWidth: 1.5,
        borderRadius: 5,
        hoverBackgroundColor: 'rgba(167,139,250,.28)',
      }],
    },
    options: { ...chartOptions('') },
  });

  // Paid vs Unpaid
  const totalRevenue = projects.reduce((s, p) => s + p.amount, 0);
  const paidRevenue  = projects.filter(p => p.paid?.trim()).reduce((s, p) => s + p.amount, 0);
  initChart('paidChart', {
    type: 'doughnut',
    data: {
      labels: ['Paid', 'Unpaid'],
      datasets: [{
        data: [paidRevenue, totalRevenue - paidRevenue],
        backgroundColor: ['rgba(34,197,94,.3)', 'rgba(239,68,68,.2)'],
        borderColor: ['#22c55e', '#ef4444'],
        borderWidth: 1.5,
        hoverOffset: 8,
      }],
    },
    options: {
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
          backgroundColor: '#1a1a1a',
          borderColor: '#333',
          borderWidth: 1,
          callbacks: { label: ctx => ' ' + fmt$(ctx.raw) },
        },
      },
    },
  });

  // Revenue by client
  const clientData = CONFIG.TABS.map((tab, i) => {
    const rev = projects.filter(p => p.client === tab).reduce((s, p) => s + p.amount, 0);
    return { tab, rev, color: CLIENT_COLORS[i % CLIENT_COLORS.length] };
  }).filter(d => d.rev > 0);

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
      responsive: true,
      maintainAspectRatio: false,
      cutout: '60%',
      plugins: {
        legend: {
          display: true,
          position: 'bottom',
          labels: { color: '#9a9a9a', padding: 10, font: { size: 11 }, boxWidth: 10 },
        },
        tooltip: {
          backgroundColor: '#1a1a1a',
          borderColor: '#333',
          borderWidth: 1,
          callbacks: { label: ctx => ' ' + ctx.label + ': ' + fmt$(ctx.raw) },
        },
      },
    },
  });
}

/** Create or replace a Chart.js instance. */
function initChart(id, config) {
  if (state.charts[id]) {
    state.charts[id].destroy();
  }
  const ctx = document.getElementById(id)?.getContext('2d');
  if (!ctx) return;
  state.charts[id] = new Chart(ctx, config);
}

// ── PROJECTS TABLE ────────────────────────────────────────────────

function initTable() {
  // Sort headers
  document.querySelectorAll('.data-table th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.sort;
      if (state.sortCol === col) {
        state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        state.sortCol = col;
        state.sortDir = 'asc';
      }
      document.querySelectorAll('.data-table th').forEach(h => {
        h.classList.remove('sort-asc', 'sort-desc');
      });
      th.classList.add('sort-' + state.sortDir);
      applyFiltersAndRender();
    });
  });

  // Filters
  ['searchInput','filterClient','filterMonth','filterPaid','filterStatus'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', () => { state.currentPage = 1; applyFiltersAndRender(); });
  });

  document.getElementById('clearFiltersBtn').addEventListener('click', () => {
    ['searchInput','filterClient','filterMonth','filterPaid','filterStatus'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    state.currentPage = 1;
    applyFiltersAndRender();
  });

  document.getElementById('exportCsvBtn').addEventListener('click', exportCsv);
}

function buildFilterOptions() {
  const clients  = [...new Set(state.allProjects.map(p => p.client))];
  const months   = [...new Set(state.allProjects.map(p => p.month))].sort((a, b) => {
    const ai = MONTH_FULL.indexOf(a), bi = MONTH_FULL.indexOf(b);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  // Dashboard client filter
  const clientFilter = document.getElementById('clientFilter');
  clientFilter.innerHTML = '<option value="all">All Clients</option>' +
    clients.map(c => `<option value="${c}">${c}</option>`).join('');
  clientFilter.addEventListener('change', () => renderDashboard());

  // Projects filters
  const filterClient = document.getElementById('filterClient');
  filterClient.innerHTML = '<option value="">All Clients</option>' +
    clients.map(c => `<option value="${c}">${c}</option>`).join('');

  const filterMonth = document.getElementById('filterMonth');
  filterMonth.innerHTML = '<option value="">All Months</option>' +
    months.map(m => `<option value="${m}">${m}</option>`).join('');
}

/**
 * Apply all active filters and sort, then re-render the table.
 */
function applyFiltersAndRender() {
  const search   = document.getElementById('searchInput')?.value.toLowerCase() || '';
  const client   = document.getElementById('filterClient')?.value || '';
  const month    = document.getElementById('filterMonth')?.value || '';
  const paid     = document.getElementById('filterPaid')?.value || '';
  const status   = document.getElementById('filterStatus')?.value || '';

  let rows = state.allProjects.slice();

  if (client) rows = rows.filter(r => r.client === client);
  if (month)  rows = rows.filter(r => r.month === month);
  if (paid === 'paid')   rows = rows.filter(r => r.paid?.trim());
  if (paid === 'unpaid') rows = rows.filter(r => !r.paid?.trim());

  if (status === 'completed') rows = rows.filter(r => r.revised?.trim());
  if (status === 'review')    rows = rows.filter(r => r.check?.trim());
  if (status === 'exported')  rows = rows.filter(r => r.revised?.trim());

  if (search) {
    rows = rows.filter(r =>
      r.name.toLowerCase().includes(search) ||
      r.client.toLowerCase().includes(search) ||
      r.date.toLowerCase().includes(search)
    );
  }

  // Sort
  rows.sort((a, b) => {
    let av, bv;
    switch (state.sortCol) {
      case 'amount': av = a.amount;  bv = b.amount;  break;
      case 'client': av = a.client;  bv = b.client;  break;
      case 'name':   av = a.name;    bv = b.name;    break;
      default:       av = a.date;    bv = b.date;
    }
    if (typeof av === 'number') return state.sortDir === 'asc' ? av - bv : bv - av;
    return state.sortDir === 'asc'
      ? String(av).localeCompare(String(bv))
      : String(bv).localeCompare(String(av));
  });

  state.filtered = rows;
  renderTable();
  renderPagination();
}

/**
 * Render the current page of the filtered table.
 */
function renderTable() {
  const start = (state.currentPage - 1) * CONFIG.ROWS_PER_PAGE;
  const page  = state.filtered.slice(start, start + CONFIG.ROWS_PER_PAGE);
  const tbody = document.getElementById('projectTableBody');

  if (!page.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="table-loading">No projects match your filters.</td></tr>`;
    return;
  }

  tbody.innerHTML = page.map(r => {
    const isPaid     = r.paid?.trim();
    const isExported = r.revised?.trim();
    const hasReview  = r.check?.trim();

    // Derive status
    let statusBadge;
    if (isExported) statusBadge = `<span class="badge badge-completed">Completed</span>`;
    else if (hasReview) statusBadge = `<span class="badge badge-review">In Review</span>`;
    else statusBadge = `<span class="badge badge-pending">Pending</span>`;

    const payBadge = isPaid
      ? `<span class="badge badge-paid">${r.paid}</span>`
      : `<span class="badge badge-unpaid">Unpaid</span>`;

    return `
      <tr>
        <td class="td-date">${r.date}</td>
        <td class="td-client">${r.client}</td>
        <td class="td-name">${escHtml(r.name)}</td>
        <td class="td-amount">${r.amount ? fmt$(r.amount) : '—'}</td>
        <td>${hasReview ? `<span class="badge badge-review">${escHtml(r.check)}</span>` : '<span style="color:var(--text-3)">—</span>'}</td>
        <td>${isExported ? `<span class="badge badge-exported" title="${escHtml(r.revised)}">Exported</span>` : '<span style="color:var(--text-3)">—</span>'}</td>
        <td>${payBadge}</td>
        <td>${statusBadge}</td>
      </tr>
    `;
  }).join('');
}

function renderPagination() {
  const total = Math.ceil(state.filtered.length / CONFIG.ROWS_PER_PAGE);
  const cur   = state.currentPage;
  const container = document.getElementById('pagination');

  if (total <= 1) { container.innerHTML = ''; return; }

  let html = `<button class="page-btn" ${cur <= 1 ? 'disabled' : ''} data-p="${cur-1}">‹</button>`;

  const range = paginationRange(cur, total);
  range.forEach(p => {
    if (p === '…') {
      html += `<span class="page-info">…</span>`;
    } else {
      html += `<button class="page-btn ${p === cur ? 'active' : ''}" data-p="${p}">${p}</button>`;
    }
  });

  html += `<button class="page-btn" ${cur >= total ? 'disabled' : ''} data-p="${cur+1}">›</button>`;
  html += `<span class="page-info">${state.filtered.length} results</span>`;

  container.innerHTML = html;
  container.querySelectorAll('.page-btn:not(:disabled)').forEach(btn => {
    btn.addEventListener('click', () => {
      state.currentPage = parseInt(btn.dataset.p, 10);
      applyFiltersAndRender();
      document.getElementById('page-projects').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

function paginationRange(cur, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set([1, total, cur, cur - 1, cur + 1].filter(p => p >= 1 && p <= total));
  const sorted = [...pages].sort((a,b) => a - b);
  const result = [];
  let prev = 0;
  sorted.forEach(p => {
    if (p - prev > 1) result.push('…');
    result.push(p);
    prev = p;
  });
  return result;
}

// ── CSV EXPORT ────────────────────────────────────────────────────

function exportCsv() {
  const rows = state.filtered;
  if (!rows.length) { showToast('No data to export.'); return; }

  const headers = ['Date','Client','Project Name','Amount','Review/Check','Revised Version','Paid'];
  const lines   = [headers.join(',')];

  rows.forEach(r => {
    lines.push([
      csvField(r.date),
      csvField(r.client),
      csvField(r.name),
      r.amount ? r.amount.toFixed(2) : '',
      csvField(r.check),
      csvField(r.revised),
      csvField(r.paid),
    ].join(','));
  });

  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `digital-catalyst-projects-${dateStamp()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('CSV exported — ' + rows.length + ' rows.');
}

// ── UTILITIES ─────────────────────────────────────────────────────

function fmt$(n) {
  if (!n && n !== 0) return '—';
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function escHtml(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function csvField(val) {
  if (!val) return '';
  const s = String(val).replace(/"/g, '""');
  return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s}"` : s;
}

function dateStamp() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 3000);
}
