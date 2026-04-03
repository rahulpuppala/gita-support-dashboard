const { getDb } = require('../config/database');

class AdminAuthor {
  static findAll() {
    const db = getDb();
    return db.prepare('SELECT * FROM admin_authors ORDER BY created_at DESC').all();
  }

  static findBySenderId(senderId) {
    const db = getDb();
    return db.prepare('SELECT * FROM admin_authors WHERE sender_id = ?').get(senderId);
  }

  static add(senderId, senderName, addedBy) {
    const db = getDb();
    const existing = this.findBySenderId(senderId);
    if (existing) return existing;
    const result = db.prepare(
      'INSERT INTO admin_authors (sender_id, sender_name, added_by) VALUES (?, ?, ?)'
    ).run(senderId, senderName, addedBy);
    return db.prepare('SELECT * FROM admin_authors WHERE id = ?').get(result.lastInsertRowid);
  }

  static remove(id) {
    const db = getDb();
    db.prepare('DELETE FROM admin_authors WHERE id = ?').run(id);
  }

  static isAdmin(senderId) {
    const db = getDb();
    return !!db.prepare('SELECT 1 FROM admin_authors WHERE sender_id = ?').get(senderId);
  }
}

module.exports = AdminAuthor;
