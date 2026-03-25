const { getDb } = require('../config/database');

class ContextDocument {
  static create({ title, content, doc_type, source_file }) {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO context_documents (title, content, doc_type, source_file)
      VALUES (?, ?, ?, ?)
    `);
    const result = stmt.run(title, content, doc_type || 'general', source_file || 'manual');
    return this.findById(result.lastInsertRowid);
  }

  static findById(id) {
    const db = getDb();
    return db.prepare('SELECT * FROM context_documents WHERE id = ?').get(id);
  }

  static update(id, { title, content, doc_type }) {
    const db = getDb();
    const stmt = db.prepare(`
      UPDATE context_documents SET title = ?, content = ?, doc_type = ?,
      updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `);
    stmt.run(title, content, doc_type, id);
    return this.findById(id);
  }

  static delete(id) {
    const db = getDb();
    db.prepare('DELETE FROM context_documents WHERE id = ?').run(id);
  }

  static findActive() {
    const db = getDb();
    return db.prepare('SELECT * FROM context_documents WHERE is_active = 1 ORDER BY created_at DESC').all();
  }

  static findAll() {
    const db = getDb();
    return db.prepare('SELECT * FROM context_documents ORDER BY created_at DESC').all();
  }

  static findByType(docType) {
    const db = getDb();
    return db.prepare('SELECT * FROM context_documents WHERE doc_type = ? AND is_active = 1').all(docType);
  }

  static search(query) {
    const db = getDb();
    return db.prepare(
      "SELECT * FROM context_documents WHERE is_active = 1 AND (title LIKE ? OR content LIKE ?)"
    ).all(`%${query}%`, `%${query}%`);
  }

  static toggleActive(id) {
    const db = getDb();
    db.prepare('UPDATE context_documents SET is_active = NOT is_active, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
    return this.findById(id);
  }

  static deleteBySourceFile(sourceFile) {
    const db = getDb();
    db.prepare('DELETE FROM context_documents WHERE source_file = ?').run(sourceFile);
  }
}

module.exports = ContextDocument;
