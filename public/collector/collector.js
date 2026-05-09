// Collector UI runtime.
// Auth: cookie-based (set by /api/auth/login).
// Tabs: collect | expense | history.

const state = {
  me: null,
  branches: [],
  safesByBranch: {},
  wallet: null,
  history: [],   // unified collections + expenses, sorted desc by time
  filter: 'all', // all | collection | expense
};

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

function getCookie(n) {
  const p = document.cookie.split(';').map((s) => s.trim()).find((s) => s.startsWith(n + '='));
  return p ? decodeURIComponent(p.slice(n.length + 1)) : null;
}
const csrf = () => getCookie('cc_csrf');

async function api(path, options = {}) {
  const opts = { method: options.method || 'GET', credentials: 'same-origin', headers: {} };
  if (opts.method !== 'GET' && opts.method !== 'HEAD') {
    const t = csrf();
    if (t) opts.headers['X-CSRF-Token'] = t;
  }
  if (options.body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(options.body);
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
  setTimeout(() => el.remove(), 2800);
}

function SAR(h) {
  if (h == null) return '0.00';
  const n = Number(h);
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  return `${sign}${Math.floor(abs / 100).toLocaleString('en-US')}.${String(abs % 100).padStart(2, '0')}`;
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

function timeAgo(ms) {
  const diff = Date.now() - Number(ms);
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'الآن';
  if (min < 60) return `قبل ${min} د`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `قبل ${hr} س`;
  const d = Math.floor(hr / 24);
  if (d < 7) return `قبل ${d} يوم`;
  const date = new Date(Number(ms) + 3 * 3600 * 1000);
  return date.toISOString().slice(0, 10);
}

const CAT_LABEL = {
  fuel: '⛽ بنزين',
  food: '🍱 طعام',
  maintenance: '🔧 صيانة',
  transfer_to_admin: '📤 تحويل للإدارة',
  other: '📌 مصروف',
};

// ---------------------------------------------------------------- Theme
function getTheme() {
  return localStorage.getItem('theme') ||
    (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
}
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  const btn = $('#theme-toggle');
  if (btn) btn.textContent = t === 'light' ? '🌙' : '☀';
}
applyTheme(getTheme());

// ---------------------------------------------------------------- Boot

async function boot() {
  let me;
  try { me = await api('/api/auth/me'); }
  catch { return location.replace('/console/'); }
  if (!me.authenticated) return location.replace('/console/');
  if (me.role !== 'collector') {
    return location.replace(me.role === 'admin' ? '/console/dashboard' : '/staff/');
  }
  state.me = me.employee;
  $('#welcome').textContent = `أهلاً ${me.employee.name}`;

  await Promise.all([loadBranches(), loadWallet()]);
  wireForm();
}

async function loadBranches() {
  const r = await api('/api/collector/branches');
  state.branches = r.items;
  for (const b of state.branches) state.safesByBranch[b.id] = b.safes || [];

  const sel = $('#collect-branch');
  sel.innerHTML = state.branches.map((b) =>
    `<option value="${b.id}">${escapeHtml(b.brand_name)} / ${escapeHtml(b.name)}</option>`
  ).join('') || '<option value="">— لا توجد فروع مسموحة —</option>';
  sel.onchange = onBranchChange;
  onBranchChange();
}

function onBranchChange() {
  const branchId = $('#collect-branch').value;
  const safes = state.safesByBranch[branchId] || [];
  $('#collect-safe').innerHTML = safes.map((s) =>
    `<option value="${s.id}">${escapeHtml(s.name)} — ${SAR(s.current_balance_halalas)} ر.س</option>`
  ).join('') || '<option value="">— لا توجد خزائن —</option>';
}

async function loadWallet() {
  const w = await api('/api/collector/wallet?limit=200');
  state.wallet = w;
  $('#balance-value').textContent = SAR(w.balance_halalas) + ' ر.س';
  $('#total-collected').textContent = SAR(w.collected_total_halalas);
  $('#total-spent').textContent = SAR(w.spent_total_halalas);
}

async function loadHistory() {
  $('#history-list').innerHTML = '<div class="muted" style="text-align:center;padding:20px;">جاري التحميل...</div>';
  try {
    const [collsR, expsR] = await Promise.all([
      api('/api/collector/collections?limit=100'),
      api('/api/collector/expenses?limit=100'),
    ]);
    const collections = (collsR.items || []).map((c) => ({
      kind: 'collection',
      time: Number(c.collected_at),
      amount: Number(c.amount_halalas),
      title: `${c.brand_name} / ${c.branch_name}`,
      sub: c.note || c.safe_name,
    }));
    const expenses = (expsR.items || []).map((e) => ({
      kind: 'expense',
      time: Number(e.spent_at),
      amount: Number(e.amount_halalas),
      title: CAT_LABEL[e.category] || '📌 مصروف',
      sub: [e.place, e.reason].filter(Boolean).join(' — '),
    }));
    state.history = [...collections, ...expenses].sort((a, b) => b.time - a.time);
    renderHistory();
  } catch (err) {
    $('#history-list').innerHTML = `<div class="muted" style="text-align:center;padding:20px;color:var(--danger);">${err.message}</div>`;
  }
}

function renderHistory() {
  const items = state.filter === 'all'
    ? state.history
    : state.history.filter((x) => x.kind === state.filter);
  if (!items.length) {
    $('#history-list').innerHTML = '<div class="muted" style="text-align:center;padding:20px;">لا توجد عمليات بعد.</div>';
    return;
  }
  $('#history-list').innerHTML = items.map((it) => {
    const isIn = it.kind === 'collection';
    return `
      <div class="entry">
        <div class="icon ${isIn ? 'in' : 'out'}">${isIn ? '⬇' : '⬆'}</div>
        <div class="body">
          <div class="title">${escapeHtml(it.title)}</div>
          <div class="sub">${escapeHtml(it.sub || '')} · ${timeAgo(it.time)}</div>
        </div>
        <div class="amount ${isIn ? 'in' : 'out'}">${isIn ? '+' : '−'}${SAR(it.amount)}</div>
      </div>`;
  }).join('');
}

// ---------------------------------------------------------------- Wire forms

function wireForm() {
  // Tabs
  $$('.tab').forEach((t) => {
    t.onclick = () => switchTab(t.dataset.tab);
  });

  // Filter pills (history)
  $$('.pill-btn').forEach((p) => {
    p.onclick = () => {
      $$('.pill-btn').forEach((x) => x.classList.toggle('active', x === p));
      state.filter = p.dataset.filter;
      renderHistory();
    };
  });

  // Submit collect
  $('#form-collect').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const data = Object.fromEntries(new FormData(f).entries());
    const branch_id = $('#collect-branch').value;
    const safe_id = $('#collect-safe').value;
    if (!branch_id || !safe_id) return toast('اختر فرع وخزنة', 'error');
    try {
      const r = await api('/api/collector/collect', {
        method: 'POST',
        body: { branch_id, safe_id, amount: data.amount, note: data.note },
      });
      toast(`✓ تم الاستلام — رصيدك ${SAR(r.wallet_balance_halalas)} ر.س`, 'success');
      f.reset();
      await Promise.all([loadBranches(), loadWallet()]);
    } catch (err) { toast(err.message, 'error'); }
  });

  // Submit expense
  $('#form-expense').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const data = Object.fromEntries(new FormData(f).entries());
    try {
      const r = await api('/api/collector/expense', {
        method: 'POST',
        body: data,
      });
      toast(`✓ تم تسجيل المصروف — رصيدك ${SAR(r.wallet_balance_halalas)} ر.س`, 'success');
      f.reset();
      await loadWallet();
    } catch (err) { toast(err.message, 'error'); }
  });

  // Logout
  $('#logout-btn').onclick = async () => {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch {}
    location.href = '/console/';
  };

  // Theme toggle
  $('#theme-toggle').onclick = () => {
    const next = getTheme() === 'light' ? 'dark' : 'light';
    localStorage.setItem('theme', next);
    applyTheme(next);
  };
}

function switchTab(name) {
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  $('#tab-collect').hidden  = name !== 'collect';
  $('#tab-expense').hidden  = name !== 'expense';
  $('#tab-history').hidden  = name !== 'history';
  if (name === 'history') loadHistory();
}

document.addEventListener('DOMContentLoaded', boot);
