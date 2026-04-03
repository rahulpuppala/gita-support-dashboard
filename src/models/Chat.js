const { getDb } = require('../config/database');

class Chat {
  static create({ source, group_id, group_name, sender_id, sender_name, message, message_type, whatsapp_msg_id }) {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO chats (source, group_id, group_name, sender_id, sender_name, message, message_type, whatsapp_msg_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(source || 'whatsapp', group_id, group_name, sender_id, sender_name, message, message_type || 'text', whatsapp_msg_id || null);
    return this.findById(result.lastInsertRowid);
  }

  static findById(id) {
    const db = getDb();
    return db.prepare('SELECT * FROM chats WHERE id = ?').get(id);
  }

  static findByWhatsAppMsgId(msgId) {
    const db = getDb();
    return db.prepare('SELECT * FROM chats WHERE whatsapp_msg_id = ?').get(msgId);
  }

  static saveClassification(id, { classification, confidence, response, reasoning, context_used, matched_faqs, status }) {
    const db = getDb();
    db.prepare(`
      UPDATE chats SET classification = ?, confidence = ?, response = ?, reasoning = ?,
      context_used = ?, matched_faqs = ?, status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      classification, confidence, response, reasoning,
      context_used ? JSON.stringify(context_used) : null,
      matched_faqs ? JSON.stringify(matched_faqs) : null,
      status, id
    );
    return this.findById(id);
  }

  static updateResponse(id, response) {
    const db = getDb();
    db.prepare(`UPDATE chats SET response = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(response, id);
    return this.findById(id);
  }

  static markSent(id) {
    const db = getDb();
    db.prepare(`UPDATE chats SET response_sent = 1, status = 'sent', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(id);
    return this.findById(id);
  }

  static findResponses(limit = 50, offset = 0) {
    const db = getDb();
    return db.prepare(`
      SELECT * FROM chats
      WHERE response IS NOT NULL
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset);
  }

  static countResponses() {
    const db = getDb();
    const row = db.prepare(`SELECT COUNT(*) as count FROM chats WHERE response IS NOT NULL`).get();
    return row.count;
  }

  static findIgnored(limit = 50, offset = 0) {
    const db = getDb();
    return db.prepare(`
      SELECT * FROM chats
      WHERE status = 'ignored'
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset);
  }

  static countIgnored() {
    const db = getDb();
    const row = db.prepare(`SELECT COUNT(*) as count FROM chats WHERE status = 'ignored'`).get();
    return row.count;
  }

  static findRecentByGroup(groupId, limit = 30) {
    const db = getDb();
    if (groupId) {
      return db.prepare(`
        SELECT sender_id, sender_name, message, created_at
        FROM chats WHERE group_id = ?
        ORDER BY created_at DESC LIMIT ?
      `).all(groupId, limit).reverse();
    }
    return db.prepare(`
      SELECT sender_id, sender_name, message, created_at
      FROM chats ORDER BY created_at DESC LIMIT ?
    `).all(limit).reverse();
  }

  static getStats() {
    const db = getDb();
    return {
      total: db.prepare('SELECT COUNT(*) as count FROM chats').get().count,
      withResponse: db.prepare("SELECT COUNT(*) as count FROM chats WHERE response IS NOT NULL").get().count,
      sent: db.prepare("SELECT COUNT(*) as count FROM chats WHERE status = 'sent'").get().count,
      pending: db.prepare("SELECT COUNT(*) as count FROM chats WHERE status = 'pending'").get().count,
    };
  }
}

module.exports = Chat;
