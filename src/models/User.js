const { getDb } = require('../config/database');
const bcrypt = require('bcryptjs');

class User {
  static create({ username, email, password, role }) {
    const db = getDb();
    const passwordHash = bcrypt.hashSync(password, 10);
    const stmt = db.prepare(`
      INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)
    `);
    const result = stmt.run(username, email, passwordHash, role || 'admin');
    return this.findById(result.lastInsertRowid);
  }

  static findById(id) {
    const db = getDb();
    const user = db.prepare('SELECT id, username, email, role, is_active, last_login, created_at FROM users WHERE id = ?').get(id);
    return user;
  }

  static findByUsername(username) {
    const db = getDb();
    return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  }

  static validatePassword(plainPassword, hashedPassword) {
    return bcrypt.compareSync(plainPassword, hashedPassword);
  }

  static updateLastLogin(id) {
    const db = getDb();
    db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(id);
  }

  static findAll() {
    const db = getDb();
    return db.prepare('SELECT id, username, email, role, is_active, last_login, created_at FROM users').all();
  }
}

module.exports = User;
