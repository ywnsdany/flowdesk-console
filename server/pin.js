import { getDb } from './db.js';

const FIFTEEN_MIN = 15 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;
const ONE_DAY = 24 * 60 * 60 * 1000;

export function checkPinRateLimit(linkId, ip) {
  const db = getDb();
  const now = Date.now();
  // Per-link: 5 fails / 15 min, 10 fails / 24h.
  const linkFails15 = db.prepare(
    `SELECT COUNT(*) AS c FROM pin_attempts WHERE link_id = ? AND success = 0 AND created_at > ?`
  ).get(linkId, now - FIFTEEN_MIN).c;
  if (linkFails15 >= 5) throw { status: 429, message: 'تجاوزت عدد المحاولات. حاول لاحقاً (١٥ دقيقة).' };
  const linkFails24 = db.prepare(
    `SELECT COUNT(*) AS c FROM pin_attempts WHERE link_id = ? AND success = 0 AND created_at > ?`
  ).get(linkId, now - ONE_DAY).c;
  if (linkFails24 >= 10) throw { status: 429, message: 'الرابط مقفل ٢٤ ساعة بسبب تكرار المحاولات.' };
  // Per-IP: 20 fails / hour.
  const ipFails60 = db.prepare(
    `SELECT COUNT(*) AS c FROM pin_attempts WHERE ip = ? AND success = 0 AND created_at > ?`
  ).get(ip, now - ONE_HOUR).c;
  if (ipFails60 >= 20) throw { status: 429, message: 'تجاوزت عدد المحاولات من هذا الجهاز.' };
}

export function recordPinAttempt(linkId, ip, success) {
  getDb().prepare(
    'INSERT INTO pin_attempts (link_id, ip, success, created_at) VALUES (?, ?, ?, ?)'
  ).run(linkId, ip, success ? 1 : 0, Date.now());
}
