require('dotenv').config();
const bcrypt = require('bcryptjs');
const { getDb, closeDb } = require('../config/database');
const { migrate } = require('./migrate');
const logger = require('../utils/logger');

function seed() {
  migrate();
  const db = getDb();

  const passwordHash = bcrypt.hashSync('admin123', 10);
  const insertUser = db.prepare(`
    INSERT OR IGNORE INTO users (username, email, password_hash, role)
    VALUES (?, ?, ?, ?)
  `);
  insertUser.run('admin', 'admin@example.com', passwordHash, 'admin');

  logger.info('Database seeded with default admin user');
}

if (require.main === module) {
  seed();
  closeDb();
  console.log('Seed complete. Default admin: admin / admin123');
}

module.exports = { seed };
