import { one, query } from './db.js';

const FIFTEEN_MIN = 15 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;
const ONE_DAY = 24 * 60 * 60 * 1000;

export async function checkPinRateLimit(linkId, ip) {
  const now = Date.now();
  const r1 = await one(
    `SELECT COUNT(*)::int AS c FROM pin_attempts WHERE link_id = $1 AND success = 0 AND created_at > $2`,
    [linkId, now - FIFTEEN_MIN]
  );
  if (r1.c >= 5) throw { status: 429, message: 'تجاوزت عدد المحاولات. حاول لاحقاً (١٥ دقيقة).' };
  const r2 = await one(
    `SELECT COUNT(*)::int AS c FROM pin_attempts WHERE link_id = $1 AND success = 0 AND created_at > $2`,
    [linkId, now - ONE_DAY]
  );
  if (r2.c >= 10) throw { status: 429, message: 'الرابط مقفل ٢٤ ساعة بسبب تكرار المحاولات.' };
  const r3 = await one(
    `SELECT COUNT(*)::int AS c FROM pin_attempts WHERE ip = $1 AND success = 0 AND created_at > $2`,
    [ip, now - ONE_HOUR]
  );
  if (r3.c >= 20) throw { status: 429, message: 'تجاوزت عدد المحاولات من هذا الجهاز.' };
}

export async function recordPinAttempt(linkId, ip, success) {
  await query(
    `INSERT INTO pin_attempts (link_id, ip, success, created_at) VALUES ($1, $2, $3, $4)`,
    [linkId, ip, success ? 1 : 0, Date.now()]
  );
}
