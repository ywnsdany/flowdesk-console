import http from 'node:http';
import { applyMigrations } from './db.js';
import { createRouter, parseCookies, send } from './router.js';
import { tryServeStatic } from './static.js';
import { startCron } from './cron.js';

import { mountAuth } from './routes/auth.js';
import { mountBrands } from './routes/brands.js';
import { mountBranches } from './routes/branches.js';
import { mountSafes } from './routes/safes.js';
import { mountEmployees } from './routes/employees.js';
import { mountLinks } from './routes/links.js';
import { mountClosings } from './routes/closings.js';
import { mountDeposits } from './routes/deposits.js';
import { mountReports } from './routes/reports.js';
import { mountFiles } from './routes/files.js';
import { mountSettings } from './routes/settings.js';
import { mountCashier } from './routes/cashier.js';
import { mountDashboard } from './routes/dashboard.js';

const PORT = parseInt(process.env.PORT || '8787', 10);
const HOST = process.env.HOST || '0.0.0.0';

applyMigrations();

const router = createRouter();
router.GET('/api/health', (req, res) => send(res, 200, { ok: true, time: Date.now() }));

mountAuth(router);
mountBrands(router);
mountBranches(router);
mountSafes(router);
mountEmployees(router);
mountLinks(router);
mountClosings(router);
mountDeposits(router);
mountReports(router);
mountFiles(router);
mountSettings(router);
mountCashier(router);
mountDashboard(router);

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    const path = url.pathname;
    req.cookies = parseCookies(req.headers.cookie);
    req.query = Object.fromEntries(url.searchParams.entries());

    if (path === '/') { res.writeHead(302, { Location: '/console/' }); return res.end(); }
    if (path === '/console') { res.writeHead(302, { Location: '/console/' }); return res.end(); }
    if (path === '/cashier') { res.writeHead(302, { Location: '/cashier/' }); return res.end(); }

    if (path.startsWith('/api/')) {
      const m = router.match(req.method, path);
      if (!m) return send(res, 404, { error: 'not found' });
      req.params = m.params;
      try {
        await m.handler(req, res);
      } catch (err) {
        const status = err?.status || 500;
        if (status >= 500) console.error('[handler]', err);
        send(res, status, { error: err?.message || 'server error' });
      }
      return;
    }

    if (tryServeStatic(req, res, path)) return;
    send(res, 404, 'not found');
  } catch (err) {
    console.error('[server]', err);
    if (!res.headersSent) send(res, 500, { error: 'server error' });
  }
});

startCron();

server.listen(PORT, HOST, () => {
  console.log(`closing-console listening on http://${HOST}:${PORT}`);
});
