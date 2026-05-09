// Collector UI — wallet that admin tops up; user records spends.

const state = {
  me: null,
  wallet: null,
  history: [],
  filter: 'all',          // all | topup | purchase
};

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

// ---------- Theme (default = light) ----------
function getTheme() {
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

// ---------- API helper ----------
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
  setTimeout(() => el.remove(), 3000);
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
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'الآن';
  if (m < 60) return `قبل ${m} د`;
  const h = Math.floor(m / 60);
  if (h < 24) return `قبل ${h} س`;
  const d = Math.floor(h / 24);
  if (d < 7) return `قبل ${d} يوم`;
  return new Date(Number(ms) + 3 * 3600 * 1000).toISOString().slice(0, 10);
}

const EXP_CATS = [
  { k: 'fuel',        l: '⛽ بنزين' },
  { k: 'food',        l: '🍱 طعام' },
  { k: 'maintenance', l: '🔧 صيانة' },
  { k: 'transport',   l: '🚗 مواصلات' },
  { k: 'other',       l: '📌 أخرى' },
];
const PUR_CATS = [
  { k: 'supplies',  l: '📦 مستلزمات' },
  { k: 'equipment', l: '🔌 معدات' },
  { k: 'inventory', l: '🍽 بضاعة' },
  { k: 'other',     l: '📌 أخرى' },
];
const ALL_CAT_LABEL = Object.fromEntries([...EXP_CATS, ...PUR_CATS].map((x) => [x.k, x.l]));

// ---------- Boot ----------
async function boot() {
  let me;
  try { me = await api('/api/auth/me'); }
  catch { return location.replace('/console/'); }
  if (!me.authenticated) return location.replace('/console/');
  if (me.role !== 'collector') {
    return location.replace(me.role === 'admin' ? '/console/dashboard' : '/staff/');
  }
  state.me = me.employee;
  $('#welcome-name').textContent = me.employee.name;

  await loadWallet();
  wire();
}

async function loadWallet() {
  const w = await api('/api/collector/wallet?limit=200');
  state.wallet = w;
  $('#balance-value').textContent = SAR(w.balance_halalas);
  $('#total-topup').textContent   = SAR(w.topup_total_halalas);
  // "صرفت" = expense + purchase combined.
  $('#total-spent').textContent   = SAR((w.expense_total_halalas || 0) + (w.purchase_total_halalas || 0));
}

async function loadHistory() {
  $('#history-list').innerHTML = '<div class="empty"><div class="ico">⏳</div><div class="big">جاري التحميل...</div></div>';
  try {
    const [walletR, expsR] = await Promise.all([
      api('/api/collector/wallet?limit=200'),
      api('/api/collector/expenses?limit=100'),
    ]);
    const topups = (walletR.ledger || [])
      .filter((m) => m.type === 'topup')
      .map((m) => ({
        kind: 'topup',
        time: Number(m.created_at),
        amount: Number(m.amount_halalas),
        title: '↓ شحن من المدير',
        sub: '',
      }));
    // All spends shown as 'purchase' (Faisal's model).
    const purchases = (expsR.items || []).map((e) => ({
      kind: 'purchase',
      time: Number(e.spent_at),
      amount: Number(e.amount_halalas),
      title: ALL_CAT_LABEL[e.category] || '🛒 مشتريات',
      sub: [e.place, e.reason].filter(Boolean).join(' — '),
    }));
    state.history = [...topups, ...purchases].sort((a, b) => b.time - a.time);
    renderHistory();
  } catch (err) {
    $('#history-list').innerHTML = `<div class="empty"><div class="big" style="color:var(--danger);">${escapeHtml(err.message)}</div></div>`;
  }
}

function renderHistory() {
  const items = state.filter === 'all' ? state.history : state.history.filter((x) => x.kind === state.filter);
  if (!items.length) {
    $('#history-list').innerHTML = '<div class="empty"><div class="ico">📭</div><div class="big">لا توجد عمليات بعد</div></div>';
    return;
  }
  $('#history-list').innerHTML = items.map((it) => {
    const isIn = it.kind === 'topup';
    const icon = isIn ? { c: 'in', e: '↓' } : { c: 'out', e: '🛒' };
    const sign = isIn ? '+' : '−';
    const amtClass = isIn ? 'in' : 'out';
    return `
      <div class="entry">
        <div class="icon ${icon.c}">${icon.e}</div>
        <div class="body">
          <div class="title">${escapeHtml(it.title)}</div>
          <div class="sub">${escapeHtml(it.sub || '')} · ${timeAgo(it.time)}</div>
        </div>
        <div class="right">
          <div class="amount ${amtClass}">${sign}${SAR(it.amount)}</div>
        </div>
      </div>`;
  }).join('');
}

// ---------- Wire up ----------
function wire() {
  $$('.tab').forEach((t) => t.onclick = () => switchTab(t.dataset.tab));

  $$('.pill-btn').forEach((p) => {
    p.onclick = () => {
      $$('.pill-btn').forEach((x) => x.classList.toggle('active', x === p));
      state.filter = p.dataset.filter;
      renderHistory();
    };
  });

  $('#form-spend').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const data = Object.fromEntries(new FormData(f).entries());
    try {
      const r = await api('/api/collector/expense', {
        method: 'POST',
        body: { ...data, kind: 'purchase' },
      });
      toast(`✓ تم — رصيدك ${SAR(r.wallet_balance_halalas)} ر.س`, 'success');
      f.reset();
      await loadWallet();
    } catch (err) { toast(err.message, 'error'); }
  });

  $('#logout-btn').onclick = async () => {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch {}
    location.href = '/console/';
  };

  $('#theme-toggle').onclick = () => {
    const next = getTheme() === 'light' ? 'dark' : 'light';
    localStorage.setItem('theme', next);
    applyTheme(next);
  };
}

function switchTab(name) {
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  $('#tab-spend').hidden    = name !== 'spend';
  $('#tab-history').hidden  = name !== 'history';
  if (name === 'history') loadHistory();
}

document.addEventListener('DOMContentLoaded', boot);
