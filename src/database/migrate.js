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
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      classification TEXT,
      confidence REAL,
      response TEXT,
      response_sent INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS actions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      action_type TEXT NOT NULL,
      action_data TEXT,
      status TEXT DEFAULT 'pending',
      result TEXT,
      error_message TEXT,
      assigned_to TEXT,
      priority INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME,
      FOREIGN KEY (chat_id) REFERENCES chats(id)
    );

    CREATE TABLE IF NOT EXISTS faqs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      keywords TEXT,
      category TEXT,
      source_file TEXT,
      confidence_threshold REAL DEFAULT 0.8,
      usage_count INTEGER DEFAULT 0,
      last_used DATETIME,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
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

    CREATE TABLE IF NOT EXISTS context_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      doc_type TEXT DEFAULT 'general',
      source_file TEXT,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_chats_classification ON chats(classification);
    CREATE INDEX IF NOT EXISTS idx_chats_status ON chats(status);
    CREATE INDEX IF NOT EXISTS idx_chats_group_id ON chats(group_id);
    CREATE INDEX IF NOT EXISTS idx_actions_status ON actions(status);
    CREATE INDEX IF NOT EXISTS idx_actions_type ON actions(action_type);
    CREATE INDEX IF NOT EXISTS idx_faqs_active ON faqs(is_active);
    CREATE INDEX IF NOT EXISTS idx_context_docs_active ON context_documents(is_active);
  `);

  // Add admin_notes column if missing (for existing DBs)
  try {
    db.exec(`ALTER TABLE actions ADD COLUMN admin_notes TEXT`);
  } catch (_) { /* column already exists */ }

  logger.info('Database migration completed successfully');
}

if (require.main === module) {
  migrate();
  closeDb();
  console.log('Migration complete.');
}

module.exports = { migrate };
