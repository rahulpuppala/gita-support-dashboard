const express = require('express');
const router = express.Router();
const Email = require('../../models/Email');
const Action = require('../../models/Action');
const { authenticateToken } = require('../../middleware/auth');
const { isAuthorized } = require('../../services/gmailAuth');
const { fetchNewEmails, fetchEmailsByDateRange, createDraftReply, sendDraft, updateDraft, labelProcessed } = require('../../services/emailService');
const { processEmail, runBackfill, getBackfillStatus, stopBackfill, DEFAULT_EMAIL_PROMPT } = require('../../services/emailProcessor');
const { getDb } = require('../../config/database');
const logger = require('../../utils/logger');

let socketIO = null;
function setSocketIO(io) { socketIO = io; }

router.use(authenticateToken);

// ─── Status ─────────────────────────────────────────────
router.get('/status', (req, res) => {
  try {
    const stats = Email.getStats();
    const db = getDb();
    const lastSyncRow = db.prepare("SELECT value, updated_at FROM settings WHERE key = 'gmail_last_sync'").get();
    res.json({
      gmailConnected: isAuthorized(),
      lastSync: lastSyncRow ? lastSyncRow.value : null,
      ...stats,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── List Emails ────────────────────────────────────────
router.get('/list', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;
    const filter = req.query.filter || null;
    const emails = Email.findAll(limit, offset, filter);

    emails.forEach(e => {
      if (e.labels && typeof e.labels === 'string') {
        try { e.labels = JSON.parse(e.labels); } catch (_) {}
      }
    });

    const total = Email.countAll(filter);
    res.json({ emails, total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Fetch New Emails ───────────────────────────────────
router.post('/fetch', async (req, res) => {
  try {
    const newEmails = await fetchNewEmails();
    res.json({ fetched: newEmails.length, emails: newEmails });
  } catch (err) {
    logger.error(`Email fetch failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ─── Process Single Email ───────────────────────────────
router.post('/:id/process', async (req, res) => {
  try {
    const email = Email.findById(parseInt(req.params.id));
    if (!email) return res.status(404).json({ error: 'Not found' });

    const result = await processEmail(email);
    const updated = Email.findById(email.id);
    if (socketIO) socketIO.emit('email_processed', { email: updated });
    res.json({ success: true, result, email: updated });
  } catch (err) {
    logger.error(`Email process failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ─── Re-evaluate Email ──────────────────────────────────
router.post('/:id/reevaluate', async (req, res) => {
  try {
    const email = Email.findById(parseInt(req.params.id));
    if (!email) return res.status(404).json({ error: 'Not found' });
    if (email.status === 'sent') return res.status(400).json({ error: 'Already sent' });

    // Reset classification
    Email.saveClassification(email.id, {
      classification: null, confidence: null, response: null,
      reasoning: null, status: 'new',
    });

    const result = await processEmail(Email.findById(email.id));
    const updated = Email.findById(email.id);
    res.json({ success: true, result, email: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Create / Update Draft ──────────────────────────────
router.post('/:id/draft', async (req, res) => {
  try {
    const email = Email.findById(parseInt(req.params.id));
    if (!email) return res.status(404).json({ error: 'Not found' });

    const replyBody = (req.body && req.body.response) ? req.body.response.trim() : email.response;
    if (!replyBody) return res.status(400).json({ error: 'No reply text provided' });

    if (email.gmail_draft_id) {
      await updateDraft(email.id, replyBody);
    } else {
      Email.updateResponse(email.id, replyBody);
      await createDraftReply(email.id, replyBody);
    }

    const updated = Email.findById(email.id);
    res.json({ success: true, email: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Edit Draft Text ────────────────────────────────────
router.put('/:id/draft', async (req, res) => {
  try {
    const email = Email.findById(parseInt(req.params.id));
    if (!email) return res.status(404).json({ error: 'Not found' });

    const { response } = req.body;
    if (!response || !response.trim()) return res.status(400).json({ error: 'Response text required' });

    await updateDraft(email.id, response.trim());
    const updated = Email.findById(email.id);
    res.json({ success: true, email: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Approve & Send Draft ───────────────────────────────
router.post('/:id/send', async (req, res) => {
  try {
    const email = Email.findById(parseInt(req.params.id));
    if (!email) return res.status(404).json({ error: 'Not found' });
    if (email.status === 'sent') return res.status(400).json({ error: 'Already sent' });

    // If response was edited, update draft first
    if (req.body && req.body.response) {
      await updateDraft(email.id, req.body.response.trim());
    }

    // Ensure draft exists
    const current = Email.findById(email.id);
    if (!current.gmail_draft_id) {
      if (!current.response) return res.status(400).json({ error: 'No draft to send' });
      await createDraftReply(email.id, current.response);
    }

    const updated = await sendDraft(email.id);
    if (socketIO) socketIO.emit('email_sent', { email: updated });
    res.json({ success: true, email: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Dismiss ────────────────────────────────────────────
router.post('/:id/dismiss', (req, res) => {
  try {
    const email = Email.findById(parseInt(req.params.id));
    if (!email) return res.status(404).json({ error: 'Not found' });

    Email.saveClassification(email.id, {
      classification: 'ignore',
      confidence: email.confidence,
      response: null,
      reasoning: 'Manually dismissed by admin.',
      status: 'ignored',
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Backfill ───────────────────────────────────────────
router.post('/backfill', async (req, res) => {
  try {
    const { startDate, endDate, delayMs, unreadOnly } = req.body;
    if (!startDate || !endDate) return res.status(400).json({ error: 'startDate and endDate are required' });

    const delay = parseInt(delayMs) || 3000;
    if (delay < 1000) return res.status(400).json({ error: 'delayMs must be at least 1000' });

    // Step 1: fetch emails in range
    const newEmails = await fetchEmailsByDateRange(startDate, endDate, { unreadOnly: !!unreadOnly });

    // Step 2: find unprocessed ones
    const unprocessed = newEmails.filter(e => !e.classification);

    if (unprocessed.length === 0) {
      return res.json({ message: 'No new unprocessed emails in this range', fetched: newEmails.length });
    }

    // Step 3: kick off backfill async
    runBackfill(unprocessed, delay, socketIO).catch(err => {
      logger.error(`Backfill error: ${err.message}`);
    });

    res.json({
      message: `Backfill started: ${unprocessed.length} emails to process`,
      fetched: newEmails.length,
      toProcess: unprocessed.length,
      delayMs: delay,
    });
  } catch (err) {
    logger.error(`Backfill start failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

router.post('/backfill/stop', (req, res) => {
  stopBackfill();
  res.json({ success: true, message: 'Stop requested' });
});

router.get('/backfill/status', (req, res) => {
  res.json(getBackfillStatus());
});

// ─── Email Prompt ───────────────────────────────────────
router.get('/prompt', (req, res) => {
  try {
    const db = getDb();
    const row = db.prepare("SELECT value, updated_at FROM settings WHERE key = 'email_llm_prompt'").get();
    res.json({
      content: row ? row.value : DEFAULT_EMAIL_PROMPT,
      isCustom: !!row,
      updated_at: row ? row.updated_at : null,
      defaultTemplate: DEFAULT_EMAIL_PROMPT,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/prompt', (req, res) => {
  try {
    const { content } = req.body;
    if (content === undefined) return res.status(400).json({ error: 'content is required' });
    const db = getDb();
    db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES ('email_llm_prompt', ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`).run(content);
    logger.info(`Email LLM prompt updated (${content.length} chars)`);
    res.json({ success: true, length: content.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/prompt/reset', (req, res) => {
  try {
    const db = getDb();
    db.prepare("DELETE FROM settings WHERE key = 'email_llm_prompt'").run();
    logger.info('Email LLM prompt reset to default');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Single Email Detail (MUST be after all named routes) ─
router.get('/:id', (req, res) => {
  try {
    const email = Email.findById(parseInt(req.params.id));
    if (!email) return res.status(404).json({ error: 'Not found' });

    if (email.labels && typeof email.labels === 'string') {
      try { email.labels = JSON.parse(email.labels); } catch (_) {}
    }

    // Get thread context
    const threadEmails = Email.findByThreadId(email.gmail_thread_id);
    res.json({ email, thread: threadEmails });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.setSocketIO = setSocketIO;
