// Riyadh timezone helpers. Riyadh is UTC+3 with no DST.
const RIYADH_OFFSET_MS = 3 * 60 * 60 * 1000;

export function now() {
  return Date.now();
}

// Returns a millisecond timestamp at the start of the day (Riyadh tz) for the given ms.
export function startOfDayRiyadh(ms) {
  const local = new Date(ms + RIYADH_OFFSET_MS);
  local.setUTCHours(0, 0, 0, 0);
  return local.getTime() - RIYADH_OFFSET_MS;
}

export function endOfDayRiyadh(ms) {
  return startOfDayRiyadh(ms) + 24 * 60 * 60 * 1000 - 1;
}

// "YYYY-MM-DD" in Riyadh tz.
export function toRiyadhDate(ms) {
  const local = new Date(ms + RIYADH_OFFSET_MS);
  return local.toISOString().slice(0, 10);
}

// Parse "YYYY-MM-DD" as start-of-day Riyadh.
export function parseRiyadhDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw { status: 400, message: 'invalid date' };
  return new Date(s + 'T00:00:00.000Z').getTime() - RIYADH_OFFSET_MS;
}

export function formatRiyadhDateTime(ms) {
  if (!ms) return '';
  const local = new Date(ms + RIYADH_OFFSET_MS);
  return local.toISOString().replace('T', ' ').slice(0, 16);
}
