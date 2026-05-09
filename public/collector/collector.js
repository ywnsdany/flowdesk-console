// Collector UI — light/dark, 4 tabs (collect / transfer / spend / history).

const state = {
  me: null,
  branches: [],
  safesByBranch: {},
  wallet: null,
  history: [],
  filter: 'all',          // all | collection | transfer | expense | purchase
  spendKind: 'expense',   // expense | purchase
};

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

// ---------- Theme (default = light) ----------
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

  await Promise.all([loadBranches(), loadWallet()]);
  wire();
}

async function loadBranches() {
  const r = await api('/api/collector/branches');
  state.branches = r.items;
  for (const b of state.branches) state.safesByBranch[b.id] = b.safes || [];

  const sel = $('#collect-branch');
  sel.innerHTML = state.branches.length
    ? state.branches.map((b) => `<option value="${b.id}">${escapeHtml(b.brand_name)} / ${escapeHtml(b.name)}</option>`).join('')
    : '<option value="">— لا توجد فروع مسموحة —</option>';
  sel.onchange = onBranchChange;
  onBranchChange();
}

function onBranchChange() {
  const branchId = $('#collect-branch').value;
  const safes = state.safesByBranch[branchId] || [];
  $('#collect-safe').innerHTML = safes.length
    ? safes.map((s) => `<option value="${s.id}">${escapeHtml(s.name)} — ${SAR(s.current_balance_halalas)} ر.س</option>`).join('')
    : '<option value="">— لا توجد خزائن —</option>';
}

async function loadWallet() {
  const w = await api('/api/collector/wallet?limit=200');
  state.wallet = w;
  $('#balance-value').textContent = SAR(w.balance_halalas);
  $('#total-collected').textContent  = SAR(w.collected_total_halalas);
  $('#total-transferred').textContent = SAR(w.transfer_total_halalas);
  $('#total-expense').textContent     = SAR(w.expense_total_halalas);
  $('#total-purchase').textContent    = SAR(w.purchase_total_halalas);

  const banner = $('#pending-banner');
  if (w.pending_transfer_count > 0) {
    banner.hidden = false;
    $('#pending-text').textContent =
      `لديك ${w.pending_transfer_count} تحويل قيد المراجعة من المدير — مجموعها ${SAR(w.pending_transfer_halalas)} ر.س`;
  } else {
    banner.hidden = true;
  }
}

async function loadHistory() {
  $('#history-list').innerHTML = '<div class="empty"><div class="ico">⏳</div><div class="big">جاري التحميل...</div></div>';
  try {
    const [collsR, expsR, transR] = await Promise.all([
      api('/api/collector/collections?limit=100'),
      api('/api/collector/expenses?limit=100'),
      api('/api/collector/transfers?limit=100'),
    ]);
    const collections = (collsR.items || []).map((c) => ({
      kind: 'collection',
      time: Number(c.collected_at),
      amount: Number(c.amount_halalas),
      title: `${c.brand_name} / ${c.branch_name}`,
      sub: c.note || c.safe_name,
    }));
    const expenses = (expsR.items || []).map((e) => ({
      kind: e.kind === 'purchase' ? 'purchase' : 'expense',
      time: Number(e.spent_at),
      amount: Number(e.amount_halalas),
      title: ALL_CAT_LABEL[e.category] || (e.kind === 'purchase' ? '🛒 مشتريات' : '⬆ مصروف'),
      sub: [e.place, e.reason].filter(Boolean).join(' — '),
    }));
    const transfers = (transR.items || []).map((t) => ({
      kind: 'transfer',
      time: Number(t.submitted_at),
      amount: Number(t.amount_halalas),
      title: '↗ تسليم للمدير',
      sub: t.note || (t.status === 'rejected' ? `مرفوض: ${t.reject_reason || ''}` : ''),
      status: t.status,
    }));
    state.history = [...collections, ...expenses, ...transfers].sort((a, b) => b.time - a.time);
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
    const icon = it.kind === 'collection' ? { c: 'in',   e: '⬇' }
              : it.kind === 'transfer'   ? { c: 'warn', e: '↗' }
              : it.kind === 'purchase'   ? { c: 'out',  e: '🛒' }
              :                            { c: 'out',  e: '⬆' };
    const sign = it.kind === 'collection' ? '+' : (it.status === 'pending' || it.status === 'rejected' ? '' : '−');
    const amtClass = it.kind === 'collection' ? 'in'
                  : it.status === 'pending' || it.status === 'rejected' ? '' : 'out';
    const pill = it.status ? `<span class="pill ${it.status}">${({pending:'بانتظار', confirmed:'مؤكد', rejected:'مرفوض'})[it.status] || ''}</span>` : '';
    return `
      <div class="entry">
        <div class="icon ${icon.c}">${icon.e}</div>
        <div class="body">
          <div class="title">${escapeHtml(it.title)}</div>
          <div class="sub">${escapeHtml(it.sub || '')} · ${timeAgo(it.time)}</div>
        </div>
        <div class="right">
          <div class="amount ${amtClass}">${sign}${SAR(it.amount)}</div>
          ${pill}
        </div>
      </div>`;
  }).join('');
}

function refreshSpendCategories() {
  const cats = state.spendKind === 'purchase' ? PUR_CATS : EXP_CATS;
  $('#spend-category').innerHTML = cats.map((c) => `<option value="${c.k}">${c.l}</option>`).join('');
  const btn = $('#btn-spend');
  if (state.spendKind === 'purchase') {
    btn.textContent = '🛒 تسجيل المشتريات';
    btn.classList.remove('danger'); btn.classList.add('warn');
  } else {
    btn.textContent = '⬆ تسجيل المصروف';
    btn.classList.remove('warn'); btn.classList.add('danger');
  }
}

// ---------- Wire up ----------
function wire() {
  // Tabs
  $$('.tab').forEach((t) => t.onclick = () => switchTab(t.dataset.tab));

  // Filter pills
  $$('.pill-btn').forEach((p) => {
    p.onclick = () => {
      $$('.pill-btn').forEach((x) => x.classList.toggle('active', x === p));
      state.filter = p.dataset.filter;
      renderHistory();
    };
  });

  // Segmented (expense/purchase)
  $$('.seg-opt').forEach((s) => {
    s.onclick = () => {
      $$('.seg-opt').forEach((x) => x.classList.toggle('active', x === s));
      state.spendKind = s.dataset.kind;
      refreshSpendCategories();
    };
  });
  refreshSpendCategories();

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

  // Submit transfer
  $('#form-transfer').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const data = Object.fromEntries(new FormData(f).entries());
    try {
      await api('/api/collector/transfer', { method: 'POST', body: data });
      toast('✓ تم إرسال طلب التسليم — بانتظار تأكيد المدير', 'success');
      f.reset();
      await loadWallet();
    } catch (err) { toast(err.message, 'error'); }
  });

  // Submit spend (expense or purchase)
  $('#form-spend').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const data = Object.fromEntries(new FormData(f).entries());
    try {
      const r = await api('/api/collector/expense', {
        method: 'POST',
        body: { ...data, kind: state.spendKind },
      });
      toast(`✓ تم — رصيدك ${SAR(r.wallet_balance_halalas)} ر.س`, 'success');
      f.reset();
      await loadWallet();
    } catch (err) { toast(err.message, 'error'); }
  });

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
}

function switchTab(name) {
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  $('#tab-collect').hidden  = name !== 'collect';
  $('#tab-transfer').hidden = name !== 'transfer';
  $('#tab-spend').hidden    = name !== 'spend';
  $('#tab-history').hidden  = name !== 'history';
  if (name === 'history') loadHistory();
}

document.addEventListener('DOMContentLoaded', boot);
