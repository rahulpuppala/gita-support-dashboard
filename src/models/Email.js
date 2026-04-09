const { getDb } = require('../config/database');

class Email {
  static create({ gmail_msg_id, gmail_thread_id, from_address, from_name, to_address, subject, body_text, body_snippet, received_at, labels }) {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO emails (gmail_msg_id, gmail_thread_id, from_address, from_name, to_address, subject, body_text, body_snippet, received_at, labels)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      gmail_msg_id, gmail_thread_id, from_address, from_name, to_address,
      subject, body_text, body_snippet, received_at,
      labels ? JSON.stringify(labels) : null
    );
    return this.findById(result.lastInsertRowid);
  }

  static createSafe({ gmail_msg_id, gmail_thread_id, from_address, from_name, to_address, subject, body_text, body_snippet, received_at, labels }) {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO emails (gmail_msg_id, gmail_thread_id, from_address, from_name, to_address, subject, body_text, body_snippet, received_at, labels)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      gmail_msg_id, gmail_thread_id, from_address, from_name, to_address,
      subject, body_text, body_snippet, received_at,
      labels ? JSON.stringify(labels) : null
    );
    if (result.changes === 0) return null; // already existed
    return this.findById(result.lastInsertRowid);
  }

  static findById(id) {
    const db = getDb();
    return db.prepare('SELECT * FROM emails WHERE id = ?').get(id);
  }

  static findByGmailMsgId(gmailMsgId) {
    const db = getDb();
    return db.prepare('SELECT * FROM emails WHERE gmail_msg_id = ?').get(gmailMsgId);
  }

  static findByThreadId(threadId) {
    const db = getDb();
    return db.prepare('SELECT * FROM emails WHERE gmail_thread_id = ? ORDER BY received_at ASC').all(threadId);
  }

  static saveClassification(id, { classification, confidence, response, reasoning, status, duplicate_of }) {
    const db = getDb();
    db.prepare(`
      UPDATE emails SET classification = ?, confidence = ?, response = ?, reasoning = ?,
      status = ?, duplicate_of = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(classification, confidence, response, reasoning, status, duplicate_of || null, id);
    return this.findById(id);
  }

  static updateResponse(id, response) {
    const db = getDb();
    db.prepare('UPDATE emails SET response = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(response, id);
    return this.findById(id);
  }

  static updateDraftId(id, gmailDraftId) {
    const db = getDb();
    db.prepare("UPDATE emails SET gmail_draft_id = ?, status = 'draft_created', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(gmailDraftId, id);
    return this.findById(id);
  }

  static markSent(id) {
    const db = getDb();
    db.prepare("UPDATE emails SET status = 'sent', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
    return this.findById(id);
  }

  static findAll(limit = 50, offset = 0, filter = null) {
    const db = getDb();
    let where = '';
    if (filter === 'answer') where = "WHERE classification = 'answer'";
    else if (filter === 'action') where = "WHERE classification = 'remove_host'";
    else if (filter === 'ignored') where = "WHERE status = 'ignored'";
    else if (filter === 'duplicate') where = "WHERE classification = 'duplicate'";
    else if (filter === 'pending') where = "WHERE status IN ('classified', 'draft_created')";

    return db.prepare(`SELECT * FROM emails ${where} ORDER BY received_at DESC LIMIT ? OFFSET ?`).all(limit, offset);
  }

  static countAll(filter = null) {
    const db = getDb();
    let where = '';
    if (filter === 'answer') where = "WHERE classification = 'answer'";
    else if (filter === 'action') where = "WHERE classification = 'remove_host'";
    else if (filter === 'ignored') where = "WHERE status = 'ignored'";
    else if (filter === 'duplicate') where = "WHERE classification = 'duplicate'";
    else if (filter === 'pending') where = "WHERE status IN ('classified', 'draft_created')";

    return db.prepare(`SELECT COUNT(*) as count FROM emails ${where}`).get().count;
  }

  static getStats() {
    const db = getDb();
    return {
      total: db.prepare('SELECT COUNT(*) as count FROM emails').get().count,
      classified: db.prepare("SELECT COUNT(*) as count FROM emails WHERE classification IS NOT NULL").get().count,
      drafts: db.prepare("SELECT COUNT(*) as count FROM emails WHERE gmail_draft_id IS NOT NULL").get().count,
      sent: db.prepare("SELECT COUNT(*) as count FROM emails WHERE status = 'sent'").get().count,
      pending: db.prepare("SELECT COUNT(*) as count FROM emails WHERE status IN ('new', 'classified', 'draft_created')").get().count,
      ignored: db.prepare("SELECT COUNT(*) as count FROM emails WHERE status = 'ignored'").get().count,
      duplicates: db.prepare("SELECT COUNT(*) as count FROM emails WHERE classification = 'duplicate'").get().count,
    };
  }

  static findThreadClassified(threadId, excludeId) {
    const db = getDb();
    return db.prepare(`
      SELECT * FROM emails
      WHERE gmail_thread_id = ? AND id != ? AND classification IS NOT NULL AND classification != 'duplicate'
      ORDER BY received_at ASC LIMIT 1
    `).get(threadId, excludeId);
  }
}

module.exports = Email;
