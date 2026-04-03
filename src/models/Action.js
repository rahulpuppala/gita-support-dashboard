const { getDb } = require('../config/database');

class Action {
  static create({ chat_id, action_type, sender_id, sender_name, group_id, details }) {
    const db = getDb();
    const result = db.prepare(`
      INSERT INTO actions (chat_id, action_type, sender_id, sender_name, group_id, details)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(chat_id, action_type, sender_id, sender_name, group_id, details ? JSON.stringify(details) : null);
    return this.findById(result.lastInsertRowid);
  }

  static findById(id) {
    const db = getDb();
    return db.prepare('SELECT * FROM actions WHERE id = ?').get(id);
  }

  static findAll(limit = 50, offset = 0) {
    const db = getDb();
    return db.prepare(`
      SELECT a.*, c.message as original_message
      FROM actions a
      LEFT JOIN chats c ON a.chat_id = c.id
      ORDER BY a.created_at DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset);
  }

  static countAll() {
    const db = getDb();
    const row = db.prepare('SELECT COUNT(*) as count FROM actions').get();
    return row.count;
  }

  static countPending() {
    const db = getDb();
    const row = db.prepare("SELECT COUNT(*) as count FROM actions WHERE status = 'pending'").get();
    return row.count;
  }

  static resolve(id, resolvedBy) {
    const db = getDb();
    db.prepare(`
      UPDATE actions SET status = 'resolved', resolved_by = ?, resolved_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(resolvedBy, id);
    return this.findById(id);
  }
}

module.exports = Action;
