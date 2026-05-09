// Staff (employee) UI runtime.
// Auth: cookie-based (set by /api/auth/login).
// Flow: load me → load branches+safes → user fills form → submit.

const state = {
  me: null,
  branches: [],
  safesByBranch: {},
  settingsByBranch: {},
  currentBranch: null,
  currentSettings: null,
  attachments: {}, // kind -> { storage_key, mime, size }
};

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

function getCookie(name) {
  const part = document.cookie.split(';').map((s) => s.trim()).find((s) => s.startsWith(name + '='));
  if (!part) return null;
  return decodeURIComponent(part.slice(name.length + 1));
}
const csrf = () => getCookie('cc_csrf');

async function api(path, options = {}) {
  const opts = { method: options.method || 'GET', credentials: 'same-origin', headers: {} };
  if (opts.method !== 'GET' && opts.method !== 'HEAD') {
    const t = csrf();
    if (t) opts.headers['X-CSRF-Token'] = t;
  }
  if (options.body !== undefined && !(options.body instanceof FormData)) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(options.body);
  } else if (options.body instanceof FormData) {
    opts.body = options.body;
  }
  const res = await fetch(path, opts);
  const ct = res.headers.get('content-type') || '';
  const payload = ct.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) throw new Error((payload && payload.error) || `${res.status}`);
  return payload;
}

function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

function SAR(h) {
  if (h == null) return '0.00';
  const n = Number(h);
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  return `${sign}${Math.floor(abs / 100).toLocaleString('en-US')}.${String(abs % 100).padStart(2, '0')}`;
}

function toHalalas(s) {
  if (!s) return 0;
  const t = String(s).trim().replace(/,/g, '');
  if (!/^-?\d+(\.\d{1,2})?$/.test(t)) return 0;
  const [w, f = ''] = t.split('.');
  const sign = w.startsWith('-') ? -1 : 1;
  const padded = (f + '00').slice(0, 2);
  return sign * (parseInt(w.replace('-', ''), 10) * 100 + parseInt(padded || '0', 10));
}

function formatDate(ms) {
  if (!ms) return '';
  const d = new Date(Number(ms) + 3 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}
function formatDateTime(ms) {
  if (!ms) return '';
  const d = new Date(Number(ms) + 3 * 3600 * 1000);
  return d.toISOString().replace('T', ' ').slice(0, 16);
}

// ---------------------------------------------------------------- Theme

function getTheme() {
  // One-time reset for users who saved dark before the redesign.
  const VERSION = '2';
  if (localStorage.getItem('theme_v') !== VERSION) {
    localStorage.setItem('theme_v', VERSION);
    localStorage.setItem('theme', 'light');
  }
  return localStorage.getItem('theme') || 'light';
}
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  const btn = $('#theme-toggle');
  if (btn) btn.textContent = t === 'light' ? '🌙' : '☀';
}
applyTheme(getTheme());

// ---------------------------------------------------------------- Boot

async function boot() {
  // Auth check.
  let me;
  try {
    me = await api('/api/auth/me');
  } catch (err) {
    location.href = '/console/';
    return;
  }
  if (!me.authenticated || me.role !== 'employee') {
    location.href = me.role === 'admin' ? '/console/dashboard' : '/console/';
    return;
  }
  state.me = me.employee;
  $('#where').textContent = `${me.employee.name}${me.branches?.length ? ' • ' + me.branches.length + ' فرع' : ''}`;

  // Load branches + safes.
  const data = await api('/api/staff/branches');
  state.branches = data.items;
  for (const b of state.branches) {
    state.safesByBranch[b.id] = b.safes;
    state.settingsByBranch[b.id] = b.settings;
  }

  // Date default = today (Riyadh).
  const today = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
  $('#closing-date').value = today;
  // Min = today - 7 days (so 7 day window inclusive).
  const sevenAgo = new Date(Date.now() - 6 * 24 * 3600 * 1000 + 3 * 3600 * 1000).toISOString().slice(0, 10);
  $('#closing-date').min = sevenAgo;
  $('#closing-date').max = today;

  // Branch select.
  const branchSel = $('#branch-select');
  branchSel.innerHTML = state.branches.map((b) =>
    `<option value="${b.id}">${escapeHtml(b.brand_name)} / ${escapeHtml(b.name)}</option>`
  ).join('');
  if (state.branches.length === 1) {
    $('#branch-field').style.display = 'none'; // hide if only one branch
  }
  branchSel.addEventListener('change', onBranchChange);
  onBranchChange();

  // Wire form
  wireForm();
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

// ---------------------------------------------------------------- Branch change

function onBranchChange() {
  const branchId = $('#branch-select').value;
  state.currentBranch = state.branches.find((b) => b.id === branchId);
  state.currentSettings = state.settingsByBranch[branchId] || {};

  // Safe select
  const safes = state.safesByBranch[branchId] || [];
  const safeSel = $('#safe-select');
  safeSel.innerHTML = safes.map((s) =>
    `<option value="${s.id}">${escapeHtml(s.name)} (${SAR(s.current_balance_halalas)} ر.س)</option>`
  ).join('') || '<option value="">— لا توجد خزائن —</option>';

  // Apps section visibility
  const enable = !!state.currentSettings.enable_apps_sales;
  $('#apps-section').hidden = !enable;

  // Recompute required tiles
  markRequiredTiles();
}

// ---------------------------------------------------------------- Form

function wireForm() {
  // Tabs
  $$('.tab').forEach((t) => {
    t.onclick = () => switchTab(t.dataset.tab);
  });

  // Apps inputs
  ['keeta', 'hungerstation', 'jahez', 'ninja'].forEach((n) => {
    const el = $(`input[name="${n}"]`);
    if (el) el.addEventListener('input', () => { updateAppsSum(); markRequiredTiles(); });
  });

  // Custody expense triggers required-tile recompute
  $('input[name="custody_expense"]').addEventListener('input', markRequiredTiles);

  // Photo uploads
  $$('.photo-tile input[type="file"]').forEach((inp) => {
    inp.addEventListener('change', (e) => uploadOne(e.target.dataset.kind, e.target.files[0], e.target));
  });

  // Submit
  $('#form').addEventListener('submit', submitClosing);

  // Logout
  $('#logout-btn').onclick = async () => {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch {}
    location.href = '/console/';
  };

  // Theme
  $('#theme-toggle').onclick = () => {
    const next = getTheme() === 'light' ? 'dark' : 'light';
    localStorage.setItem('theme', next);
    applyTheme(next);
  };

  markRequiredTiles();
}

function switchTab(name) {
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  $('#tab-new').hidden = name !== 'new';
  $('#tab-history').hidden = name !== 'history';
  if (name === 'history') loadHistory();
}

function currentAppsSum() {
  return ['keeta', 'hungerstation', 'jahez', 'ninja']
    .map((n) => toHalalas(($(`input[name="${n}"]`)?.value) || 0))
    .reduce((a, b) => a + b, 0);
}

function updateAppsSum() {
  const sum = currentAppsSum();
  const el = $('#apps-sum');
  if (el) el.textContent = SAR(sum);
}

function markRequiredTiles() {
  const s = state.currentSettings || {};
  const expenseHalalas = toHalalas($('input[name="custody_expense"]')?.value || 0);
  const appAmt = (n) => toHalalas(($(`input[name="${n}"]`)?.value) || 0);
  const requireMap = {
    foodics_invoice: !!s.require_foodics_img,
    network: !!s.require_network_img,
    cash: !!s.require_cash_img,
    custody_receipt: !!(s.require_custody_receipt_img && expenseHalalas > 0),
    app_keeta:         !!(s.enable_apps_sales && appAmt('keeta')         > 0),
    app_hungerstation: !!(s.enable_apps_sales && appAmt('hungerstation') > 0),
    app_jahez:         !!(s.enable_apps_sales && appAmt('jahez')         > 0),
    app_ninja:         !!(s.enable_apps_sales && appAmt('ninja')         > 0),
  };
  $$('.photo-tile').forEach((tile) => {
    const kind = tile.dataset.kind;
    tile.classList.toggle('required', !!requireMap[kind]);
  });
}

async function uploadOne(kind, file, inputEl) {
  if (!file) return;
  const tile = inputEl.closest('.photo-tile');
  tile.classList.remove('have');
  tile.classList.add('uploading');
  try {
    const fd = new FormData();
    fd.append('kind', kind);
    fd.append('file', file);
    const r = await api('/api/staff/upload', { method: 'POST', body: fd });
    state.attachments[kind] = r;
    const reader = new FileReader();
    reader.onload = () => {
      tile.classList.remove('uploading');
      tile.classList.add('have');
      tile.querySelector('.icon')?.remove();
      const old = tile.querySelector('img');
      if (old) old.remove();
      const img = document.createElement('img');
      img.src = reader.result;
      tile.appendChild(img);
    };
    reader.readAsDataURL(file);
  } catch (err) {
    toast(err.message, 'error');
    tile.classList.remove('uploading');
  }
}

async function submitClosing(e) {
  e.preventDefault();
  const f = $('#form');
  const data = Object.fromEntries(new FormData(f).entries());
  const branchId = $('#branch-select').value;
  const safeId = $('#safe-select').value;
  if (!safeId) return toast('اختر خزنة', 'error');

  const attachments = Object.entries(state.attachments).map(([kind, a]) => ({
    kind, storage_key: a.storage_key, mime: a.mime, size: a.size,
  }));

  const body = {
    branch_id: branchId,
    safe_id: safeId,
    closing_date: data.closing_date,
    foodics_total: data.foodics_total,
    network_total: data.network_total,
    cash_in_safe: data.cash_in_safe,
    custody_in_hand: data.custody_in_hand || 0,
    custody_expense: data.custody_expense || 0,
    custody_expense_note: data.custody_expense_note || '',
    notes: data.notes || '',
    attachments,
  };
  if (state.currentSettings.enable_apps_sales) {
    body.keeta = data.keeta || 0;
    body.hungerstation = data.hungerstation || 0;
    body.jahez = data.jahez || 0;
    body.ninja = data.ninja || 0;
    body.keeta_note = data.keeta_note || '';
    body.hungerstation_note = data.hungerstation_note || '';
    body.jahez_note = data.jahez_note || '';
    body.ninja_note = data.ninja_note || '';
    body.apps_invoice_count = data.apps_invoice_count || 0;
  }

  const btn = $('#submit');
  btn.disabled = true; btn.textContent = '...';
  try {
    const r = await api('/api/staff/closing', { method: 'POST', body });
    showResult(r.result);
  } catch (err) {
    toast(err.message, 'error');
    btn.disabled = false; btn.textContent = 'إرسال التقفيل';
  }
}

function showResult(r) {
  const v = Number(r.variance_halalas);
  const cls = v > 0 ? 'pos' : v < 0 ? 'neg' : 'zero';
  const status = v > 0 ? 'زيادة بالخزنة' : v < 0 ? 'عجز بالخزنة' : 'متطابق ✓';
  const icon = v === 0 ? '✓' : v > 0 ? '↑' : '↓';
  $('#result-icon').textContent = icon;
  $('#result-icon').className = 'icon-wrap ' + cls;
  $('#result-status').textContent = status;
  $('#result-status').className = 'big ' + cls;
  $('#result-amount').textContent = SAR(Math.abs(v)) + ' ر.س';
  $('#result-amount').className = 'amount ' + cls;
  $('#result-breakdown').innerHTML = `
    <div class="row"><span class="label">الافتتاحي</span><span class="val">${SAR(r.opening_balance_halalas)}</span></div>
    <div class="row"><span class="label">+ كاش الشفت</span><span class="val">${SAR(r.cash_sales_halalas)}</span></div>
    <div class="row"><span class="label">= المتوقع</span><span class="val">${SAR(r.expected_cash_halalas)}</span></div>
    <div class="row"><span class="label">الفعلي بالخزنة</span><span class="val">${SAR(r.cash_in_safe_halalas)}</span></div>
    <div class="row"><span class="label"><strong>الفرق</strong></span><span class="val ${cls}"><strong>${SAR(v)}</strong></span></div>
  `;
  // Hide other sections.
  $('#tab-new').hidden = true;
  $('#tab-history').hidden = true;
  document.querySelector('.tabs').style.display = 'none';
  $('#screen-result').hidden = false;
}

// ---------------------------------------------------------------- History

async function loadHistory() {
  const root = $('#history-list');
  root.innerHTML = '<div class="muted" style="text-align:center;padding:20px;">جاري التحميل...</div>';
  try {
    const r = await api('/api/staff/closings');
    if (!r.items.length) {
      root.innerHTML = '<div class="muted" style="text-align:center;padding:20px;">لا توجد تقفيلات سابقة بعد.</div>';
      return;
    }
    const STATUS = { pending: 'بانتظار', confirmed: 'مؤكد', rejected: 'مرفوض' };
    root.innerHTML = r.items.map((c) => {
      const v = Number(c.variance_halalas);
      const cls = v > 0 ? 'amount-pos' : v < 0 ? 'amount-neg' : 'amount-zero';
      return `
        <div class="closing-card">
          <div class="row1">
            <span class="date">${c.closing_date ? formatDate(c.closing_date) : formatDateTime(c.submitted_at)}</span>
            <span class="pill ${c.status}">${STATUS[c.status] || c.status}</span>
          </div>
          <div class="where">${escapeHtml(c.brand_name)} / ${escapeHtml(c.branch_name)} / ${escapeHtml(c.safe_name)}</div>
          <div class="meta">
            <span>المبيعات: <span class="num">${SAR(c.total_sales_halalas)}</span></span>
            <span>الكاش: <span class="num">${SAR(c.cash_in_safe_halalas)}</span></span>
            <span>الفرق: <span class="num ${cls}">${SAR(v)}</span></span>
          </div>
          ${c.reject_reason ? `<div class="reject">سبب الرفض: ${escapeHtml(c.reject_reason)}</div>` : ''}
        </div>`;
    }).join('');
  } catch (err) {
    root.innerHTML = `<div class="muted" style="text-align:center;padding:20px;color:var(--danger);">${err.message}</div>`;
  }
}

document.addEventListener('DOMContentLoaded', boot);
