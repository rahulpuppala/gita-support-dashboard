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

  const insertFaq = db.prepare(`
    INSERT OR IGNORE INTO faqs (question, answer, keywords, category, source_file)
    VALUES (?, ?, ?, ?, ?)
  `);

  const sampleFaqs = [
    {
      question: 'How do I join the group?',
      answer: 'You can join the group by clicking the invite link shared by the admin or by being added directly by a group admin.',
      keywords: 'join,group,invite,link,add',
      category: 'General',
      source_file: 'sample',
    },
    {
      question: 'What are the group rules?',
      answer: 'Please be respectful to all members, stay on topic, and avoid spam. Detailed rules are pinned in the group description.',
      keywords: 'rules,guidelines,policy,behavior',
      category: 'General',
      source_file: 'sample',
    },
    {
      question: 'Who are the admins?',
      answer: 'You can see the list of admins by opening the group info. Admins have a special badge next to their name.',
      keywords: 'admin,admins,moderator,contact',
      category: 'General',
      source_file: 'sample',
    },
  ];

  for (const faq of sampleFaqs) {
    insertFaq.run(faq.question, faq.answer, faq.keywords, faq.category, faq.source_file);
  }

  logger.info('Database seeded with default admin and sample FAQs');
}

if (require.main === module) {
  seed();
  closeDb();
  console.log('Seed complete. Default admin: admin / admin123');
}

module.exports = { seed };
