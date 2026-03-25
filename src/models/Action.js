const { getDb } = require('../config/database');

class Action {
  static create({ chat_id, action_type, action_data, priority }) {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO actions (chat_id, action_type, action_data, priority)
      VALUES (?, ?, ?, ?)
    `);
    const result = stmt.run(chat_id, action_type, JSON.stringify(action_data || {}), priority || 1);
    return this.findById(result.lastInsertRowid);
  }

  static findById(id) {
    const db = getDb();
    const action = db.prepare('SELECT * FROM actions WHERE id = ?').get(id);
    if (action && action.action_data) {
      try { action.action_data = JSON.parse(action.action_data); } catch (_) {}
    }
    if (action && action.result) {
      try { action.result = JSON.parse(action.result); } catch (_) {}
    }
    return action;
  }

  static updateStatus(id, status, result, error_message) {
    const db = getDb();
    const stmt = db.prepare(`
      UPDATE actions SET status = ?, result = ?, error_message = ?,
      completed_at = CASE WHEN ? IN ('completed', 'failed') THEN CURRENT_TIMESTAMP ELSE completed_at END
      WHERE id = ?
    `);
    stmt.run(status, result ? JSON.stringify(result) : null, error_message, status, id);
    return this.findById(id);
  }

  static assignTo(id, adminUsername) {
    const db = getDb();
    db.prepare('UPDATE actions SET assigned_to = ?, status = ? WHERE id = ?').run(adminUsername, 'processing', id);
    return this.findById(id);
  }

  static findByStatus(status, limit = 50, offset = 0) {
    const db = getDb();
    return db.prepare(`
      SELECT a.*, c.message, c.sender_name, c.group_name
      FROM actions a JOIN chats c ON a.chat_id = c.id
      WHERE a.status = ? ORDER BY a.created_at DESC LIMIT ? OFFSET ?
    `).all(status, limit, offset);
  }

  static findByType(action_type, limit = 50, offset = 0) {
    const db = getDb();
    return db.prepare(`
      SELECT a.*, c.message, c.sender_name, c.group_name
      FROM actions a JOIN chats c ON a.chat_id = c.id
      WHERE a.action_type = ? ORDER BY a.created_at DESC LIMIT ? OFFSET ?
    `).all(action_type, limit, offset);
  }

  static findByStatusAndType(status, action_type, limit = 50, offset = 0) {
    const db = getDb();
    return db.prepare(`
      SELECT a.*, c.message, c.sender_name, c.group_name
      FROM actions a JOIN chats c ON a.chat_id = c.id
      WHERE a.status = ? AND a.action_type = ? ORDER BY a.created_at DESC LIMIT ? OFFSET ?
    `).all(status, action_type, limit, offset);
  }

  static findAll(limit = 50, offset = 0) {
    const db = getDb();
    return db.prepare(`
      SELECT a.*, c.message, c.sender_name, c.group_name
      FROM actions a JOIN chats c ON a.chat_id = c.id
      ORDER BY a.created_at DESC LIMIT ? OFFSET ?
    `).all(limit, offset);
  }

  static delete(id) {
    const db = getDb();
    db.prepare('DELETE FROM actions WHERE id = ?').run(id);
  }

  static update(id, { action_type, action_data, status, priority }) {
    const db = getDb();
    const fields = [];
    const values = [];
    if (action_type !== undefined) { fields.push('action_type = ?'); values.push(action_type); }
    if (action_data !== undefined) { fields.push('action_data = ?'); values.push(JSON.stringify(action_data)); }
    if (status !== undefined) { fields.push('status = ?'); values.push(status); }
    if (priority !== undefined) { fields.push('priority = ?'); values.push(priority); }
    if (fields.length === 0) return this.findById(id);
    values.push(id);
    db.prepare(`UPDATE actions SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return this.findById(id);
  }

  static addNote(id, note) {
    const db = getDb();
    const action = this.findById(id);
    if (!action) return null;
    const existing = action.admin_notes || '';
    const timestamp = new Date().toLocaleString();
    const updated = existing ? `${existing}\n[${timestamp}] ${note}` : `[${timestamp}] ${note}`;
    db.prepare('UPDATE actions SET admin_notes = ? WHERE id = ?').run(updated, id);
    return this.findById(id);
  }

  static getStats() {
    const db = getDb();
    return {
      total: db.prepare('SELECT COUNT(*) as count FROM actions').get().count,
      pending: db.prepare("SELECT COUNT(*) as count FROM actions WHERE status = 'pending'").get().count,
      processing: db.prepare("SELECT COUNT(*) as count FROM actions WHERE status = 'processing'").get().count,
      completed: db.prepare("SELECT COUNT(*) as count FROM actions WHERE status = 'completed'").get().count,
      failed: db.prepare("SELECT COUNT(*) as count FROM actions WHERE status = 'failed'").get().count,
      byType: db.prepare("SELECT action_type, COUNT(*) as count FROM actions GROUP BY action_type").all(),
    };
  }
}

module.exports = Action;
