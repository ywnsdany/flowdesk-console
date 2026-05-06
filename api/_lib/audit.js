import { query } from './db.js';

export async function audit(accountantId, action, entityType, entityId, before, after) {
  await query(
    `INSERT INTO audit_log (accountant_id, action, entity_type, entity_id, before_json, after_json, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      accountantId,
      action,
      entityType,
      entityId,
      before ? JSON.stringify(before) : null,
      after ? JSON.stringify(after) : null,
      Date.now(),
    ]
  );
}
