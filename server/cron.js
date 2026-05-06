import { getDb } from './db.js';
import { cleanupPending } from './storage.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export function startCron() {
  // Run once at startup, then every hour.
  const tick = () => {
    try {
      const removed = cleanupPending(DAY_MS);
      const db = getDb();
      const cutoff = Date.now() - DAY_MS;
      const { changes: pinPurged } = db.prepare('DELETE FROM pin_attempts WHERE created_at < ?').run(cutoff);
      const { changes: signupPurged } = db.prepare('DELETE FROM signup_attempts WHERE created_at < ?').run(cutoff);
      if (removed || pinPurged || signupPurged) {
        console.log(`[cron] cleanup: files=${removed} pin_attempts=${pinPurged} signup_attempts=${signupPurged}`);
      }
    } catch (err) {
      console.error('[cron] error', err);
    }
  };
  tick();
  setInterval(tick, HOUR_MS).unref();
}
