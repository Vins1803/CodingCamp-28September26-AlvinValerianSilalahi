/* ============================================================
   Budget Tracker — app.js
   Vanilla JS · LocalStorage · Chart.js doughnut · hand-rolled bar
   Features: dark/light mode · monthly summary · sortable history
   ============================================================ */

'use strict';

// ── Constants ────────────────────────────────────────────────
const STORAGE_KEY       = 'budgetTracker_transactions';
const THEME_STORAGE_KEY = 'budgetTracker_theme';

const CATEGORY_ICONS = {
  'Food & Drink':  '🍔',
  'Transport':     '🚌',
  'Shopping':      '🛍️',
  'Health':        '💊',
  'Entertainment': '🎮',
  'Education':     '📚',
  'Bills':         '🧾',
  'Salary':        '💼',
  'Other':         '📦',
};

const CHART_COLOURS = [
  '#6366f1', '#22c55e', '#ef4444', '#f59e0b',
  '#3b82f6', '#ec4899', '#14b8a6', '#8b5cf6', '#f97316',
];

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

// ── State ────────────────────────────────────────────────────
let transactions = [];
let deleteTarget = null;

// Monthly summary navigation state (year + 0-based month index)
const now = new Date();
let summaryYear  = now.getFullYear();
let summaryMonth = now.getMonth();

// ── DOM References ───────────────────────────────────────────
const totalBalanceEl  = document.getElementById('totalBalance');
const totalIncomeEl   = document.getElementById('totalIncome');
const totalExpenseEl  = document.getElementById('totalExpense');

const form            = document.getElementById('transactionForm');
const descInput       = document.getElementById('txDescription');
const amountInput     = document.getElementById('txAmount');
const typeSelect      = document.getElementById('txType');
const categorySelect  = document.getElementById('txCategory');
const dateInput       = document.getElementById('txDate');
const formError       = document.getElementById('formError');

const txList          = document.getElementById('transactionList');
const txEmpty         = document.getElementById('txEmpty');
const filterCategory  = document.getElementById('filterCategory');
const sortOrder       = document.getElementById('sortOrder');
const clearAllBtn     = document.getElementById('clearAllBtn');

// Pie chart
const pieCanvas       = document.getElementById('pieChart');
const pieEmpty        = document.getElementById('pieEmpty');
const pieLegend       = document.getElementById('pieLegend');
// Bar chart (hand-rolled)
const canvas          = document.getElementById('spendingChart');
const chartEmpty      = document.getElementById('chartEmpty');
// Chart tabs
const tabPie          = document.getElementById('tabPie');
const tabBar          = document.getElementById('tabBar');
const panelPie        = document.getElementById('panelPie');
const panelBar        = document.getElementById('panelBar');

// Monthly summary
const monthLabel      = document.getElementById('monthLabel');
const monthlyCards    = document.getElementById('monthlyCards');
const monthlyTableBody= document.getElementById('monthlyTableBody');
const monthlyEmpty    = document.getElementById('monthlyEmpty');
const monthPrev       = document.getElementById('monthPrev');
const monthNext       = document.getElementById('monthNext');

// Dark mode
const themeToggle     = document.getElementById('themeToggle');
const themeIcon       = document.getElementById('themeIcon');

// Modal
const modalOverlay    = document.getElementById('modalOverlay');
const modalTitle      = document.getElementById('modalTitle');
const modalConfirm    = document.getElementById('modalConfirm');
const modalCancel     = document.getElementById('modalCancel');

// ── Helpers ──────────────────────────────────────────────────

function formatRupiah(amount) {
  return 'Rp ' + Math.abs(amount).toLocaleString('id-ID');
}

function formatDate(isoDate) {
  if (!isoDate) return '';
  const [year, month, day] = isoDate.split('-');
  const d = new Date(Number(year), Number(month) - 1, Number(day));
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ── Dark / Light Mode ────────────────────────────────────────

function initTheme() {
  const saved = localStorage.getItem(THEME_STORAGE_KEY);
  // Default: light unless user previously chose dark, or OS prefers dark
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const isDark = saved ? saved === 'dark' : prefersDark;
  applyTheme(isDark);
}

function applyTheme(isDark) {
  document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
  themeIcon.textContent = isDark ? '☀️' : '🌙';
  themeToggle.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
  localStorage.setItem(THEME_STORAGE_KEY, isDark ? 'dark' : 'light');
  // Update Chart.js border colour to match new surface colour
  if (pieChartInstance) {
    const surface = getComputedStyle(document.documentElement)
      .getPropertyValue('--clr-surface').trim();
    pieChartInstance.data.datasets[0].borderColor = surface || '#ffffff';
    pieChartInstance.update('none');
  }
}

function toggleTheme() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  applyTheme(!isDark);
}

themeToggle.addEventListener('click', toggleTheme);

// ── LocalStorage ─────────────────────────────────────────────

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    transactions = raw ? JSON.parse(raw) : [];
  } catch {
    transactions = [];
  }
}

function saveToStorage() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(transactions));
}

// ── Summary Cards (all-time) ──────────────────────────────────

function updateSummary() {
  const income  = transactions
    .filter(t => t.type === 'income')
    .reduce((sum, t) => sum + t.amount, 0);
  const expense = transactions
    .filter(t => t.type === 'expense')
    .reduce((sum, t) => sum + t.amount, 0);
  const balance = income - expense;

  totalBalanceEl.textContent = formatRupiah(balance);
  totalIncomeEl.textContent  = formatRupiah(income);
  totalExpenseEl.textContent = formatRupiah(expense);

  totalBalanceEl.style.color = balance >= 0
    ? 'var(--clr-income)'
    : 'var(--clr-expense)';
}

// ── Monthly Summary ───────────────────────────────────────────

function renderMonthlySummary() {
  monthLabel.textContent = `${MONTH_NAMES[summaryMonth]} ${summaryYear}`;

  // Filter transactions for the selected month
  const monthTx = transactions.filter(t => {
    if (!t.date) return false;
    const [y, m] = t.date.split('-').map(Number);
    return y === summaryYear && m === summaryMonth + 1;
  });

  const monthIncome  = monthTx.filter(t => t.type === 'income') .reduce((s, t) => s + t.amount, 0);
  const monthExpense = monthTx.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  const monthBalance = monthIncome - monthExpense;
  const txCount      = monthTx.length;

  // Mini stat cards
  monthlyCards.innerHTML = `
    <div class="mcard mcard--income">
      <span class="mcard__label">💚 Income</span>
      <span class="mcard__value">${formatRupiah(monthIncome)}</span>
    </div>
    <div class="mcard mcard--expense">
      <span class="mcard__label">❤️ Expenses</span>
      <span class="mcard__value">${formatRupiah(monthExpense)}</span>
    </div>
    <div class="mcard mcard--net">
      <span class="mcard__label">⚖️ Net</span>
      <span class="mcard__value" style="color:${monthBalance >= 0 ? 'var(--clr-income)' : 'var(--clr-expense)'}">
        ${monthBalance >= 0 ? '+' : '−'}${formatRupiah(monthBalance)}
      </span>
    </div>
    <div class="mcard mcard--count">
      <span class="mcard__label">📋 Transactions</span>
      <span class="mcard__value">${txCount}</span>
    </div>
  `;

  // Category breakdown table
  if (monthTx.length === 0) {
    monthlyTableBody.innerHTML = '';
    monthlyEmpty.hidden = false;
    return;
  }
  monthlyEmpty.hidden = true;

  // Aggregate by category
  const cats = {};
  monthTx.forEach(t => {
    if (!cats[t.category]) cats[t.category] = { income: 0, expense: 0 };
    cats[t.category][t.type] += t.amount;
  });

  // Sort by total spend desc
  const rows = Object.entries(cats).sort((a, b) => {
    const netA = a[1].expense - a[1].income;
    const netB = b[1].expense - b[1].income;
    return netB - netA;
  });

  monthlyTableBody.innerHTML = rows.map(([cat, vals]) => {
    const net    = vals.income - vals.expense;
    const netStr = net >= 0 ? `+${formatRupiah(net)}` : `−${formatRupiah(net)}`;
    const netCls = net >= 0 ? 'clr-income' : 'clr-expense';
    const icon   = CATEGORY_ICONS[cat] || '📦';
    return `
      <tr>
        <td>${icon} ${escapeHtml(cat)}</td>
        <td class="ta-right clr-expense">${vals.expense > 0 ? formatRupiah(vals.expense) : '—'}</td>
        <td class="ta-right clr-income">${vals.income  > 0 ? formatRupiah(vals.income)  : '—'}</td>
        <td class="ta-right ${netCls} fw-bold">${netStr}</td>
      </tr>`;
  }).join('');
}

monthPrev.addEventListener('click', () => {
  summaryMonth--;
  if (summaryMonth < 0) { summaryMonth = 11; summaryYear--; }
  renderMonthlySummary();
});

monthNext.addEventListener('click', () => {
  summaryMonth++;
  if (summaryMonth > 11) { summaryMonth = 0; summaryYear++; }
  renderMonthlySummary();
});

// ── Chart helpers ─────────────────────────────────────────────

function buildCategoryTotals() {
  const totals = {};
  transactions
    .filter(t => t.type === 'expense')
    .forEach(t => {
      totals[t.category] = (totals[t.category] || 0) + t.amount;
    });
  return totals;
}

// ── Pie chart (Chart.js doughnut) ────────────────────────────

let pieChartInstance = null;

function drawPieChart() {
  const totals  = buildCategoryTotals();
  const entries = Object.entries(totals).sort((a, b) => b[1] - a[1]);

  if (entries.length === 0) {
    pieCanvas.style.display = 'none';
    pieEmpty.style.display  = 'block';
    pieLegend.innerHTML     = '';
    if (pieChartInstance) { pieChartInstance.destroy(); pieChartInstance = null; }
    return;
  }

  pieCanvas.style.display = 'block';
  pieEmpty.style.display  = 'none';

  const labels  = entries.map(([cat]) => cat);
  const data    = entries.map(([, v]) => v);
  const colours = entries.map((_, i) => CHART_COLOURS[i % CHART_COLOURS.length]);

  const surfaceColour = getComputedStyle(document.documentElement)
    .getPropertyValue('--clr-surface').trim() || '#ffffff';

  if (pieChartInstance) {
    pieChartInstance.data.labels                      = labels;
    pieChartInstance.data.datasets[0].data            = data;
    pieChartInstance.data.datasets[0].backgroundColor = colours;
    pieChartInstance.data.datasets[0].borderColor     = surfaceColour;
    pieChartInstance.update();
  } else {
    pieChartInstance = new Chart(pieCanvas, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor: colours,
          borderColor:     surfaceColour,
          borderWidth:     3,
          hoverOffset:     10,
        }],
      },
      options: {
        responsive:          true,
        maintainAspectRatio: true,
        cutout:              '60%',
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label(ctx) {
                const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                const pct   = ((ctx.parsed / total) * 100).toFixed(1);
                return ` ${formatRupiah(ctx.parsed)}  (${pct}%)`;
              },
            },
          },
        },
        animation: { duration: 400, easing: 'easeInOutQuart' },
      },
    });
  }

  const totalExpense = data.reduce((a, b) => a + b, 0);
  pieLegend.innerHTML = entries.map(([cat, amt], i) => {
    const pct  = ((amt / totalExpense) * 100).toFixed(1);
    const icon = CATEGORY_ICONS[cat] || '📦';
    return `
      <li class="legend-item">
        <span class="legend-swatch" style="background:${colours[i]}"></span>
        <span class="legend-label">${icon} ${cat}</span>
        <span class="legend-pct">${pct}%</span>
        <span class="legend-amt">${formatRupiah(amt)}</span>
      </li>`;
  }).join('');
}

// ── Bar chart (hand-rolled canvas) ───────────────────────────

function drawBarChart() {
  const ctx     = canvas.getContext('2d');
  const totals  = buildCategoryTotals();
  const entries = Object.entries(totals).sort((a, b) => b[1] - a[1]);

  if (entries.length === 0) {
    canvas.style.display     = 'none';
    chartEmpty.style.display = 'block';
    return;
  }

  canvas.style.display     = 'block';
  chartEmpty.style.display = 'none';

  // Resolve CSS vars for dark-mode-aware colours
  const style      = getComputedStyle(document.documentElement);
  const clrMuted   = style.getPropertyValue('--clr-text-bar-label').trim()  || '#64748b';
  const clrText    = style.getPropertyValue('--clr-text-bar-value').trim()  || '#1e293b';
  const clrTrack   = style.getPropertyValue('--clr-bar-track').trim()       || '#f1f5f9';

  const containerWidth = canvas.parentElement.clientWidth - 48;
  const BAR_HEIGHT  = 32;
  const BAR_GAP     = 12;
  const LABEL_WIDTH = 110;
  const VALUE_WIDTH = 110;
  const CHART_WIDTH = Math.max(200, containerWidth - LABEL_WIDTH - VALUE_WIDTH - 16);
  const CANVAS_H    = entries.length * (BAR_HEIGHT + BAR_GAP) + BAR_GAP;

  const dpr          = window.devicePixelRatio || 1;
  const totalCanvasW = LABEL_WIDTH + CHART_WIDTH + VALUE_WIDTH + 16;
  canvas.width       = totalCanvasW * dpr;
  canvas.height      = CANVAS_H * dpr;
  canvas.style.width  = totalCanvasW + 'px';
  canvas.style.height = CANVAS_H + 'px';
  ctx.scale(dpr, dpr);

  const maxVal = entries[0][1];
  ctx.clearRect(0, 0, totalCanvasW, CANVAS_H);

  entries.forEach(([category, amount], i) => {
    const y      = BAR_GAP + i * (BAR_HEIGHT + BAR_GAP);
    const barW   = Math.max(4, (amount / maxVal) * CHART_WIDTH);
    const colour = CHART_COLOURS[i % CHART_COLOURS.length];
    const icon   = CATEGORY_ICONS[category] || '📦';

    ctx.fillStyle    = clrMuted;
    ctx.font         = `600 12px "Segoe UI", system-ui, sans-serif`;
    ctx.textAlign    = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(icon + ' ' + category, LABEL_WIDTH - 8, y + BAR_HEIGHT / 2);

    ctx.fillStyle = clrTrack;
    roundRect(ctx, LABEL_WIDTH, y, CHART_WIDTH, BAR_HEIGHT, 6);
    ctx.fill();

    ctx.fillStyle = colour;
    roundRect(ctx, LABEL_WIDTH, y, barW, BAR_HEIGHT, 6);
    ctx.fill();

    ctx.fillStyle = clrText;
    ctx.font      = `700 12px "Segoe UI", system-ui, sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillText(formatRupiah(amount), LABEL_WIDTH + CHART_WIDTH + 10, y + BAR_HEIGHT / 2);
  });
}

function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y,     x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x,     y + h, r);
  ctx.arcTo(x,     y + h, x,     y,     r);
  ctx.arcTo(x,     y,     x + w, y,     r);
  ctx.closePath();
}

function drawChart() {
  drawPieChart();
  drawBarChart();
}

// ── Chart tab switching ───────────────────────────────────────

function activateTab(tab) {
  const isPie = tab === 'pie';
  tabPie.classList.toggle('chart-tab--active', isPie);
  tabBar.classList.toggle('chart-tab--active', !isPie);
  tabPie.setAttribute('aria-selected', isPie ? 'true' : 'false');
  tabBar.setAttribute('aria-selected', isPie ? 'false' : 'true');
  panelPie.hidden = !isPie;
  panelBar.hidden =  isPie;
  if (!isPie) drawBarChart();
}

tabPie.addEventListener('click', () => activateTab('pie'));
tabBar.addEventListener('click', () => activateTab('bar'));

// ── Transaction List (filterable + sortable) ──────────────────

function sortTransactions(list) {
  const order = sortOrder.value;
  return [...list].sort((a, b) => {
    switch (order) {
      case 'date-asc':
        return new Date(a.date) - new Date(b.date) || a.createdAt - b.createdAt;
      case 'amount-desc':
        return b.amount - a.amount;
      case 'amount-asc':
        return a.amount - b.amount;
      case 'category-az':
        return a.category.localeCompare(b.category) || new Date(b.date) - new Date(a.date);
      case 'date-desc':
      default:
        return new Date(b.date) - new Date(a.date) || b.createdAt - a.createdAt;
    }
  });
}

function renderTransactions() {
  const filter   = filterCategory.value;
  const filtered = filter === 'all'
    ? [...transactions]
    : transactions.filter(t => t.category === filter);

  const sorted = sortTransactions(filtered);

  txList.innerHTML = '';

  if (sorted.length === 0) {
    txEmpty.style.display = 'block';
    return;
  }
  txEmpty.style.display = 'none';

  sorted.forEach(tx => {
    const li = document.createElement('li');
    li.className  = 'tx-item';
    li.dataset.id = tx.id;

    const icon        = CATEGORY_ICONS[tx.category] || '📦';
    const sign        = tx.type === 'income' ? '+' : '−';
    const amountClass = tx.type === 'income' ? 'tx-item__amount--income' : 'tx-item__amount--expense';
    const iconClass   = tx.type === 'income' ? 'tx-item__icon--income'   : 'tx-item__icon--expense';

    li.innerHTML = `
      <div class="tx-item__icon ${iconClass}" aria-hidden="true">${icon}</div>
      <div class="tx-item__info">
        <div class="tx-item__desc">${escapeHtml(tx.description)}</div>
        <div class="tx-item__meta">${tx.category} · ${formatDate(tx.date)}</div>
      </div>
      <div class="tx-item__right">
        <span class="tx-item__amount ${amountClass}">${sign} ${formatRupiah(tx.amount)}</span>
        <button class="tx-item__delete" aria-label="Delete ${escapeHtml(tx.description)}" data-id="${tx.id}">✕</button>
      </div>
    `;
    txList.appendChild(li);
  });
}

// ── Full Render ───────────────────────────────────────────────

function render() {
  updateSummary();
  renderMonthlySummary();
  renderTransactions();
  drawChart();
}

// ── Form Handling ─────────────────────────────────────────────

function setDefaultDate() {
  const today = new Date();
  const yyyy  = today.getFullYear();
  const mm    = String(today.getMonth() + 1).padStart(2, '0');
  const dd    = String(today.getDate()).padStart(2, '0');
  dateInput.value = `${yyyy}-${mm}-${dd}`;
}

function showError(msg) { formError.textContent = msg; }
function clearError()   { formError.textContent = ''; }

form.addEventListener('submit', e => {
  e.preventDefault();
  clearError();

  const description = descInput.value.trim();
  const amount      = parseFloat(amountInput.value);
  const type        = typeSelect.value;
  const category    = categorySelect.value;
  const date        = dateInput.value;

  if (!description) { showError('Please enter a description.'); descInput.focus(); return; }
  if (!amount || isNaN(amount) || amount <= 0) { showError('Please enter a valid amount greater than 0.'); amountInput.focus(); return; }
  if (!date) { showError('Please select a date.'); dateInput.focus(); return; }

  transactions.push({ id: generateId(), description, amount, type, category, date, createdAt: Date.now() });
  saveToStorage();
  render();

  descInput.value   = '';
  amountInput.value = '';
  descInput.focus();
});

// ── Delete Handlers ───────────────────────────────────────────

txList.addEventListener('click', e => {
  const btn = e.target.closest('.tx-item__delete');
  if (!btn) return;

  deleteTarget = btn.dataset.id;
  const tx = transactions.find(t => t.id === deleteTarget);
  modalTitle.textContent = `Delete "${tx ? tx.description : 'this transaction'}"?`;
  document.querySelector('.modal__body').textContent = 'This transaction will be permanently removed.';
  modalOverlay.removeAttribute('hidden');
  modalConfirm.focus();
});

clearAllBtn.addEventListener('click', () => {
  deleteTarget = null;
  modalTitle.textContent = 'Clear all transactions?';
  document.querySelector('.modal__body').textContent = 'This will permanently delete all your data. This cannot be undone.';
  modalOverlay.removeAttribute('hidden');
  modalConfirm.focus();
});

modalConfirm.addEventListener('click', () => {
  transactions = deleteTarget
    ? transactions.filter(t => t.id !== deleteTarget)
    : [];
  deleteTarget = null;
  saveToStorage();
  render();
  closeModal();
});

modalCancel.addEventListener('click', closeModal);

modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) closeModal(); });

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !modalOverlay.hidden) closeModal();
});

function closeModal() {
  modalOverlay.setAttribute('hidden', '');
  deleteTarget = null;
}

// ── Filter & sort listeners ───────────────────────────────────

filterCategory.addEventListener('change', renderTransactions);
sortOrder.addEventListener('change', renderTransactions);

// ── Resize ───────────────────────────────────────────────────

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(drawChart, 120);
});

// ── Boot ─────────────────────────────────────────────────────

loadFromStorage();
initTheme();
setDefaultDate();
render();
