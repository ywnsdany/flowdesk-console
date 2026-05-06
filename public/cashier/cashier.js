const params = new URLSearchParams(location.search);
const LINK_ID = params.get('l') || '';
const TOKEN = params.get('t') || '';

const state = {
  link: null,
  settings: null,
  jwt: null,
  attachments: {}, // kind -> { storage_key, mime, size }
};

function $(s) { return document.querySelector(s); }
function $$(s) { return Array.from(document.querySelectorAll(s)); }

function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

function SAR(h) {
  if (h == null) return '0.00';
  const sign = h < 0 ? '-' : '';
  const abs = Math.abs(h);
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

function show(section) {
  for (const id of ['screen-pin', 'screen-form', 'screen-result']) {
    $('#' + id).hidden = id !== section;
  }
}

async function loadLink() {
  try {
    const r = await fetch(`/api/cashier/link?l=${encodeURIComponent(LINK_ID)}&t=${encodeURIComponent(TOKEN)}`).then((x) => x.json());
    if (!r.link) throw new Error(r.error || 'رابط غير صالح');
    state.link = r.link;
    state.settings = r.settings;
    $('#where').textContent = `${r.link.brand_name} / ${r.link.branch_name} — ${r.link.safe_name}${r.link.employee_name ? ' • ' + r.link.employee_name : ''}`;
    show('screen-pin');
    setupPinInputs();
  } catch (err) {
    document.body.innerHTML = `<div class="shell"><div class="head"><div class="logo">!</div><h1>رابط غير صالح</h1><div class="where" style="color:var(--danger);">الرجاء التواصل مع المحاسب لاستلام رابط جديد</div></div></div>`;
  }
}

function setupPinInputs() {
  const inputs = document.querySelectorAll('.pin-grid input');
  inputs.forEach((inp, idx) => {
    inp.addEventListener('input', (e) => {
      e.target.value = e.target.value.replace(/\D/g, '').slice(0, 1);
      if (e.target.value && idx < inputs.length - 1) inputs[idx + 1].focus();
      const all = Array.from(inputs).map((x) => x.value).join('');
      if (all.length === 6) submitPin(all);
    });
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !inp.value && idx > 0) inputs[idx - 1].focus();
    });
  });
  inputs[0].focus();
}

async function submitPin(pin) {
  try {
    const r = await fetch('/api/cashier/pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ link_id: LINK_ID, token: TOKEN, pin }),
    }).then(async (x) => {
      const j = await x.json();
      if (!x.ok) throw new Error(j.error || 'خطأ');
      return j;
    });
    state.jwt = r.token;
    show('screen-form');
    onFormReady();
  } catch (err) {
    toast(err.message, 'error');
    document.querySelectorAll('.pin-grid input').forEach((i) => i.value = '');
    document.querySelector('.pin-grid input').focus();
  }
}

function onFormReady() {
  // Toggle apps section based on branch settings.
  const appsSection = $('#apps-section');
  if (state.settings.enable_apps_sales) {
    appsSection.hidden = false;
    ['keeta', 'hungerstation', 'jahez', 'ninja'].forEach((n) => {
      $(`input[name="${n}"]`).addEventListener('input', updateAppsSum);
    });
  }
  // Mark required photo tiles based on settings.
  markRequiredTiles();
  // Wire up upload handlers on every photo tile.
  $$('.photo-tile input[type="file"]').forEach((inp) => {
    inp.addEventListener('change', (e) => uploadOne(e.target.dataset.kind, e.target.files[0], e.target));
  });
  // Watch custody_expense to mark/unmark custody_receipt as required dynamically.
  $('input[name="custody_expense"]').addEventListener('input', markRequiredTiles);
}

function markRequiredTiles() {
  const s = state.settings;
  const expenseHalalas = toHalalas($('input[name="custody_expense"]').value);
  const requireMap = {
    foodics_invoice: !!s.require_foodics_img,
    network: !!s.require_network_img,
    cash: !!s.require_cash_img,
    apps: !!(s.enable_apps_sales && s.require_apps_img && currentAppsSum() > 0),
    custody_receipt: !!(s.require_custody_receipt_img && expenseHalalas > 0),
  };
  $$('.photo-tile').forEach((tile) => {
    const kind = tile.dataset.kind;
    tile.classList.toggle('required', !!requireMap[kind]);
  });
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
  markRequiredTiles();
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
    const r = await fetch(`/api/cashier/upload?l=${encodeURIComponent(LINK_ID)}`, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + state.jwt },
      body: fd,
    }).then(async (x) => {
      const j = await x.json();
      if (!x.ok) throw new Error(j.error || 'خطأ في الرفع');
      return j;
    });
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
  const attachments = Object.entries(state.attachments).map(([kind, a]) => ({
    kind, storage_key: a.storage_key, mime: a.mime, size: a.size,
  }));
  const btn = $('#submit');
  btn.disabled = true; btn.textContent = '...';
  try {
    const body = {
      foodics_total: data.foodics_total,
      network_total: data.network_total,
      cash_in_safe: data.cash_in_safe,
      custody_in_hand: data.custody_in_hand || 0,
      custody_expense: data.custody_expense || 0,
      custody_expense_note: data.custody_expense_note || '',
      notes: data.notes || '',
      attachments,
    };
    if (state.settings.enable_apps_sales) {
      body.keeta = data.keeta || 0;
      body.hungerstation = data.hungerstation || 0;
      body.jahez = data.jahez || 0;
      body.ninja = data.ninja || 0;
    }
    const r = await fetch(`/api/cashier/closing?l=${encodeURIComponent(LINK_ID)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + state.jwt },
      body: JSON.stringify(body),
    }).then(async (x) => {
      const j = await x.json();
      if (!x.ok) throw new Error(j.error || 'خطأ');
      return j;
    });
    showResult(r.result);
  } catch (err) {
    toast(err.message, 'error');
    btn.disabled = false; btn.textContent = 'إرسال التقفيل';
  }
}

function showResult(result) {
  const v = result.variance_halalas;
  const cls = v > 0 ? 'pos' : v < 0 ? 'neg' : 'zero';
  const status = v > 0 ? 'زيادة بالخزنة' : v < 0 ? 'عجز بالخزنة' : 'متطابق ✓';
  const icon = v === 0 ? '✓' : v > 0 ? '↑' : '↓';
  const iconEl = $('#result-icon');
  iconEl.textContent = icon;
  iconEl.className = 'icon-wrap ' + cls;
  $('#result-status').textContent = status;
  $('#result-status').className = 'big ' + cls;
  $('#result-amount').textContent = SAR(Math.abs(v)) + ' ر.س';
  $('#result-amount').className = 'amount ' + cls;
  $('#result-breakdown').innerHTML = `
    <div class="row"><span class="label">الافتتاحي</span><span class="val">${SAR(result.opening_balance_halalas)}</span></div>
    <div class="row"><span class="label">+ كاش الشفت</span><span class="val">${SAR(result.cash_sales_halalas)}</span></div>
    <div class="row"><span class="label">= المتوقع</span><span class="val">${SAR(result.expected_cash_halalas)}</span></div>
    <div class="row"><span class="label">الفعلي بالخزنة</span><span class="val">${SAR(result.cash_in_safe_halalas)}</span></div>
    <div class="row"><span class="label"><strong>الفرق</strong></span><span class="val ${cls}"><strong>${SAR(v)}</strong></span></div>
  `;
  show('screen-result');
}

document.addEventListener('DOMContentLoaded', () => {
  loadLink();
  $('#form').addEventListener('submit', submitClosing);
});
