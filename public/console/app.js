// Shared console runtime: auth bootstrap, fetch wrapper, toast/modal, formatters.

const PUBLIC_PAGES = new Set(['/console/', '/console/index.html', '/console/signup', '/console/signup.html']);

// Theme — light by default. One-time reset for users who saved dark
// before the redesign (bump 'theme_v' to force everyone back to light).
(function () {
  const VERSION = '2';
  if (localStorage.getItem('theme_v') !== VERSION) {
    localStorage.setItem('theme_v', VERSION);
    localStorage.setItem('theme', 'light');
  }
  const theme = localStorage.getItem('theme') || 'light';
  document.documentElement.setAttribute('data-theme', theme);
})();
window.getTheme = () => document.documentElement.getAttribute('data-theme') || 'light';
window.setTheme = (t) => {
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem('theme', t);
  const labels = document.querySelectorAll('[data-theme-label]');
  labels.forEach((el) => { el.textContent = t === 'light' ? '☀ فاتح' : '🌙 غامق'; });
};
window.toggleTheme = () => window.setTheme(window.getTheme() === 'light' ? 'dark' : 'light');

function getCookie(name) {
  const part = document.cookie.split(';').map((s) => s.trim()).find((s) => s.startsWith(name + '='));
  if (!part) return null;
  return decodeURIComponent(part.slice(name.length + 1));
}

window.csrf = () => getCookie('cc_csrf');

window.api = async function (path, options = {}) {
  const opts = { method: options.method || 'GET', credentials: 'same-origin', headers: {} };
  if (opts.method !== 'GET' && opts.method !== 'HEAD') {
    const token = window.csrf();
    if (token) opts.headers['X-CSRF-Token'] = token;
  }
  if (options.body !== undefined && !(options.body instanceof FormData)) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(options.body);
  } else if (options.body instanceof FormData) {
    opts.body = options.body;
  }
  const res = await fetch(path, opts);
  if (res.status === 204) return null;
  const ct = res.headers.get('content-type') || '';
  let payload = null;
  if (ct.includes('application/json')) {
    payload = await res.json();
  } else {
    payload = await res.text();
  }
  if (!res.ok) {
    const msg = (payload && payload.error) || `${res.status} ${res.statusText}`;
    throw new Error(msg);
  }
  return payload;
};

window.toast = function (msg, kind = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2800);
};

window.confirmDialog = function ({ title, body, confirmLabel = 'تأكيد', danger = false } = {}) {
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'modal-backdrop';
    back.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <div class="modal-head"></div>
        <div class="modal-body"></div>
        <div class="modal-foot">
          <button class="btn ghost" data-cancel>إلغاء</button>
          <button class="btn ${danger ? 'danger' : ''}" data-ok></button>
        </div>
      </div>`;
    document.body.appendChild(back);
    back.querySelector('.modal-head').textContent = title || '';
    back.querySelector('.modal-body').textContent = body || '';
    back.querySelector('[data-ok]').textContent = confirmLabel;
    function close(v) { back.remove(); resolve(v); }
    back.addEventListener('click', (e) => { if (e.target === back) close(false); });
    back.querySelector('[data-cancel]').onclick = () => close(false);
    back.querySelector('[data-ok]').onclick = () => close(true);
  });
};

window.SAR = function (halalas) {
  if (halalas == null) return '0.00';
  const sign = Number(halalas) < 0 ? '-' : '';
  const abs = Math.abs(Number(halalas));
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, '0');
  const grouped = whole.toLocaleString('en-US');
  return `${sign}${grouped}.${frac}`;
};

window.toHalalas = function (input) {
  if (input == null || input === '') return 0;
  const s = String(input).trim().replace(/,/g, '');
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  const sign = whole.startsWith('-') ? -1 : 1;
  const w = whole.replace('-', '');
  const padded = (frac + '00').slice(0, 2);
  return sign * (parseInt(w, 10) * 100 + parseInt(padded || '0', 10));
};

window.formatDate = function (ms) {
  if (!ms) return '';
  const d = new Date(Number(ms) + 3 * 3600 * 1000);
  return d.toISOString().replace('T', ' ').slice(0, 16);
};

window.amountClass = function (h) {
  const n = Number(h);
  if (n > 0) return 'amount-pos';
  if (n < 0) return 'amount-neg';
  return 'amount-zero';
};

window.copyToClipboard = async function (text) {
  try {
    await navigator.clipboard.writeText(text);
    window.toast('نُسخ', 'success');
  } catch {
    window.toast('فشل النسخ', 'error');
  }
};

window.openImage = function (url) {
  const back = document.createElement('div');
  back.className = 'lightbox-bg';
  back.innerHTML = `<img alt="" />`;
  back.querySelector('img').src = url;
  back.onclick = () => back.remove();
  document.body.appendChild(back);
};

window.escapeHtml = function (s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
};

async function bootstrap() {
  const path = location.pathname;
  if (PUBLIC_PAGES.has(path)) return;
  try {
    const me = await window.api('/api/auth/me');
    if (!me.authenticated) { location.href = '/console/'; return; }
    if (me.role === 'employee')  { location.href = '/staff/';     return; }
    if (me.role === 'collector') { location.href = '/collector/'; return; }
    window.me = me.accountant;
    renderSidebar(me.accountant);
  } catch (err) {
    location.href = '/console/';
  }
}

// Nav config — single source of truth for desktop sidebar + mobile drawer + bottom nav.
const NAV_GROUPS = [
  [null, [
    ['/console/dashboard', 'الرئيسية', '⌂'],
  ]],
  ['الإعداد', [
    ['/console/brands',    'البراندات', '◇'],
    ['/console/branches',  'الفروع',     '◯'],
    ['/console/safes',     'الخزائن',    '⬢'],
    ['/console/employees', 'الموظفين',   '☻'],
  ]],
  ['التشغيل', [
    ['/console/closings', 'التقفيلات', '☑'],
    ['/console/deposits', 'الإيداعات', '↓'],
    ['/console/reports',  'التقارير',  '☰'],
  ]],
];

// Bottom nav: 5 most-used pages on mobile.
const BOTTOM_NAV = [
  ['/console/dashboard', 'الرئيسية',   '⌂'],
  ['/console/closings',  'التقفيلات',  '☑'],
  ['/console/employees', 'الموظفين',   '☻'],
  ['/console/safes',     'الخزائن',    '⬢'],
  ['__menu__',           'المزيد',     '☰'],
];

function isActive(path, href) {
  return path === href || path === href + '.html' || path.startsWith(href + '/');
}

function renderSidebar(me) {
  const bar = document.getElementById('sidebar');
  const path = location.pathname;
  const initials = (me.email || me.username || '?').slice(0, 1).toUpperCase();
  const displayName = me.email || me.username || '';

  if (bar) {
    bar.innerHTML = `
      <div class="brand">
        <div class="logo">إ</div>
        <div class="name">إقفال<small>تقفيل اليوميات</small></div>
      </div>
      <nav>
        ${NAV_GROUPS.map(([label, links]) => `
          ${label ? `<div class="group-label">${label}</div>` : ''}
          ${links.map(([href, name, icon]) => `
            <a href="${href}" class="${isActive(path, href) ? 'active' : ''}">
              <span class="icon">${icon}</span><span>${name}</span>
            </a>`).join('')}
        `).join('')}
      </nav>
      <div class="me">
        <div class="avatar">${initials}</div>
        <div class="info"><div class="email">${window.escapeHtml(displayName)}</div></div>
        <button onclick="logout()">خروج</button>
      </div>
      <div class="theme-row">
        <button class="btn-theme" onclick="window.toggleTheme()">
          <span data-theme-label>${window.getTheme() === 'light' ? '☀ فاتح' : '🌙 غامق'}</span>
        </button>
      </div>
    `;
  }

  renderMobileChrome(me, path, initials, displayName);
}

function renderMobileChrome(me, path, initials, displayName) {
  // Top bar
  let topbar = document.querySelector('.topbar-mobile');
  if (!topbar) {
    topbar = document.createElement('header');
    topbar.className = 'topbar-mobile';
    document.body.insertBefore(topbar, document.body.firstChild);
  }
  // Find current page name for title.
  let title = 'إقفال';
  for (const [, links] of NAV_GROUPS) {
    for (const [href, name] of links) {
      if (isActive(path, href)) { title = name; break; }
    }
  }
  topbar.innerHTML = `
    <div class="brand">
      <div class="logo">إ</div>
      <div class="name">${title}</div>
    </div>
    <button class="menu-btn" id="open-drawer" aria-label="القائمة">☰</button>
  `;

  // Bottom nav
  let bnav = document.querySelector('.bottom-nav');
  if (!bnav) {
    bnav = document.createElement('nav');
    bnav.className = 'bottom-nav';
    document.body.appendChild(bnav);
  }
  bnav.innerHTML = BOTTOM_NAV.map(([href, name, icon]) => {
    if (href === '__menu__') {
      return `<a href="#" data-action="open-drawer">
        <span class="ico">${icon}</span><span>${name}</span>
      </a>`;
    }
    const active = isActive(path, href);
    return `<a href="${href}" class="${active ? 'active' : ''}">
      <span class="ico">${icon}</span><span>${name}</span>
    </a>`;
  }).join('');

  // Drawer
  let backdrop = document.querySelector('.drawer-backdrop');
  let drawer = document.querySelector('.drawer');
  if (!backdrop) {
    backdrop = document.createElement('div');
    backdrop.className = 'drawer-backdrop';
    document.body.appendChild(backdrop);
  }
  if (!drawer) {
    drawer = document.createElement('aside');
    drawer.className = 'drawer';
    document.body.appendChild(drawer);
  }
  drawer.innerHTML = `
    <div class="me">
      <div class="avatar">${initials}</div>
      <div class="info"><div class="email">${window.escapeHtml(displayName)}</div></div>
    </div>
    <nav>
      ${NAV_GROUPS.map(([label, links]) => `
        ${label ? `<div class="group-label">${label}</div>` : ''}
        ${links.map(([href, name, icon]) => `
          <a href="${href}" class="${isActive(path, href) ? 'active' : ''}">
            <span>${icon}</span><span>${name}</span>
          </a>`).join('')}
      `).join('')}
    </nav>
    <div class="actions">
      <button onclick="window.toggleTheme()">
        <span data-theme-label>${window.getTheme() === 'light' ? '☀ المظهر الفاتح' : '🌙 المظهر الغامق'}</span>
      </button>
      <button class="danger" onclick="logout()">↶ تسجيل خروج</button>
    </div>
  `;

  // Wire drawer open/close
  function openDrawer() { backdrop.classList.add('open'); drawer.classList.add('open'); }
  function closeDrawer() { backdrop.classList.remove('open'); drawer.classList.remove('open'); }
  topbar.querySelector('#open-drawer').onclick = (e) => { e.preventDefault(); openDrawer(); };
  bnav.querySelector('[data-action="open-drawer"]')?.addEventListener('click', (e) => {
    e.preventDefault(); openDrawer();
  });
  backdrop.onclick = closeDrawer;
}

window.logout = async function () {
  try { await window.api('/api/auth/logout', { method: 'POST' }); } catch {}
  location.href = '/console/';
};

document.addEventListener('DOMContentLoaded', bootstrap);
