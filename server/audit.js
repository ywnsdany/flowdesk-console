import { getDb } from './db.js';

export function audit(accountantId, action, entityType, entityId, before, after) {
  getDb()
    .prepare(
      `INSERT INTO audit_log (accountant_id, action, entity_type, entity_id, before_json, after_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      accountantId,
      action,
      entityType,
      entityId,
      before ? JSON.stringify(before) : null,
      after ? JSON.stringify(after) : null,
      Date.now()
    );
}
