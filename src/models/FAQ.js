const { getDb } = require('../config/database');

class FAQ {
  static create({ question, answer, keywords, category, source_file, confidence_threshold }) {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO faqs (question, answer, keywords, category, source_file, confidence_threshold)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(question, answer, keywords, category, source_file, confidence_threshold || 0.8);
    return this.findById(result.lastInsertRowid);
  }

  static findById(id) {
    const db = getDb();
    return db.prepare('SELECT * FROM faqs WHERE id = ?').get(id);
  }

  static update(id, { question, answer, keywords, category, confidence_threshold }) {
    const db = getDb();
    const stmt = db.prepare(`
      UPDATE faqs SET question = ?, answer = ?, keywords = ?, category = ?,
      confidence_threshold = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `);
    stmt.run(question, answer, keywords, category, confidence_threshold, id);
    return this.findById(id);
  }

  static delete(id) {
    const db = getDb();
    db.prepare('DELETE FROM faqs WHERE id = ?').run(id);
  }

  static incrementUsage(id) {
    const db = getDb();
    db.prepare('UPDATE faqs SET usage_count = usage_count + 1, last_used = CURRENT_TIMESTAMP WHERE id = ?').run(id);
  }

  static findActive() {
    const db = getDb();
    return db.prepare('SELECT * FROM faqs WHERE is_active = 1 ORDER BY usage_count DESC').all();
  }

  static findAll() {
    const db = getDb();
    return db.prepare('SELECT * FROM faqs ORDER BY created_at DESC').all();
  }

  static findByCategory(category) {
    const db = getDb();
    return db.prepare('SELECT * FROM faqs WHERE category = ? AND is_active = 1').all(category);
  }

  static search(query) {
    const db = getDb();
    return db.prepare(
      "SELECT * FROM faqs WHERE is_active = 1 AND (question LIKE ? OR answer LIKE ? OR keywords LIKE ?)"
    ).all(`%${query}%`, `%${query}%`, `%${query}%`);
  }

  static toggleActive(id) {
    const db = getDb();
    db.prepare('UPDATE faqs SET is_active = NOT is_active, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
    return this.findById(id);
  }

  static deleteBySourceFile(sourceFile) {
    const db = getDb();
    db.prepare('DELETE FROM faqs WHERE source_file = ?').run(sourceFile);
  }
}

module.exports = FAQ;
