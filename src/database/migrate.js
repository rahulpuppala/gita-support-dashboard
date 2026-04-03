require('dotenv').config();
const { getDb, closeDb } = require('../config/database');
const logger = require('../utils/logger');

function migrate() {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS chats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL DEFAULT 'whatsapp',
      group_id TEXT,
      group_name TEXT,
      sender_id TEXT NOT NULL,
      sender_name TEXT,
      message TEXT NOT NULL,
      message_type TEXT DEFAULT 'text',
      whatsapp_msg_id TEXT,
      classification TEXT,
      confidence REAL,
      response TEXT,
      response_sent INTEGER DEFAULT 0,
      status TEXT DEFAULT 'new',
      context_used TEXT,
      matched_faqs TEXT,
      reasoning TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'admin',
      is_active INTEGER DEFAULT 1,
      last_login DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS admin_authors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id TEXT UNIQUE NOT NULL,
      sender_name TEXT,
      added_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS actions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER,
      action_type TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      sender_name TEXT,
      group_id TEXT,
      details TEXT,
      status TEXT DEFAULT 'pending',
      resolved_by TEXT,
      resolved_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (chat_id) REFERENCES chats(id)
    );

    CREATE INDEX IF NOT EXISTS idx_actions_status ON actions(status);
    CREATE INDEX IF NOT EXISTS idx_chats_status ON chats(status);
    CREATE INDEX IF NOT EXISTS idx_chats_group_id ON chats(group_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_chats_whatsapp_msg_id ON chats(whatsapp_msg_id) WHERE whatsapp_msg_id IS NOT NULL;
  `);

  logger.info('Database migration completed successfully');
}

if (require.main === module) {
  migrate();
  closeDb();
  console.log('Migration complete.');
}

module.exports = { migrate };
