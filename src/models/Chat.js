const { getDb } = require('../config/database');

class Chat {
  static create({ source, group_id, group_name, sender_id, sender_name, message, message_type }) {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO chats (source, group_id, group_name, sender_id, sender_name, message, message_type)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(source || 'whatsapp', group_id, group_name, sender_id, sender_name, message, message_type || 'text');
    return this.findById(result.lastInsertRowid);
  }

  static findById(id) {
    const db = getDb();
    return db.prepare('SELECT * FROM chats WHERE id = ?').get(id);
  }

  static updateClassification(id, { classification, confidence, response, status }) {
    const db = getDb();
    const stmt = db.prepare(`
      UPDATE chats SET classification = ?, confidence = ?, response = ?, status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    stmt.run(classification, confidence, response, status || 'pending', id);
    return this.findById(id);
  }

  static markResponseSent(id) {
    const db = getDb();
    db.prepare(`UPDATE chats SET response_sent = 1, status = 'responded', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(id);
    return this.findById(id);
  }

  static updateStatus(id, status) {
    const db = getDb();
    db.prepare(`UPDATE chats SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(status, id);
    return this.findById(id);
  }

  static findByClassification(classification, limit = 50, offset = 0) {
    const db = getDb();
    return db.prepare('SELECT * FROM chats WHERE classification = ? ORDER BY created_at DESC LIMIT ? OFFSET ?').all(classification, limit, offset);
  }

  static findPending(limit = 50, offset = 0) {
    const db = getDb();
    return db.prepare("SELECT * FROM chats WHERE status = 'pending' ORDER BY created_at DESC LIMIT ? OFFSET ?").all(limit, offset);
  }

  static findAll(limit = 50, offset = 0) {
    const db = getDb();
    return db.prepare('SELECT * FROM chats ORDER BY created_at DESC LIMIT ? OFFSET ?').all(limit, offset);
  }

  static getStats() {
    const db = getDb();
    return {
      total: db.prepare('SELECT COUNT(*) as count FROM chats').get().count,
      faq: db.prepare("SELECT COUNT(*) as count FROM chats WHERE classification = 'faq'").get().count,
      action: db.prepare("SELECT COUNT(*) as count FROM chats WHERE classification = 'action'").get().count,
      unknown: db.prepare("SELECT COUNT(*) as count FROM chats WHERE classification = 'unknown'").get().count,
      pending: db.prepare("SELECT COUNT(*) as count FROM chats WHERE status = 'pending'").get().count,
      responded: db.prepare("SELECT COUNT(*) as count FROM chats WHERE status = 'responded'").get().count,
    };
  }

  static delete(id) {
    const db = getDb();
    db.prepare('DELETE FROM actions WHERE chat_id = ?').run(id);
    db.prepare('DELETE FROM chats WHERE id = ?').run(id);
  }

  static search(query, limit = 50) {
    const db = getDb();
    return db.prepare("SELECT * FROM chats WHERE message LIKE ? ORDER BY created_at DESC LIMIT ?").all(`%${query}%`, limit);
  }
}

module.exports = Chat;
