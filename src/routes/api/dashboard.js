const express = require('express');
const router = express.Router();
const Chat = require('../../models/Chat');
const AdminAuthor = require('../../models/AdminAuthor');
const Action = require('../../models/Action');
const { authenticateToken } = require('../../middleware/auth');
const whatsappService = require('../../services/whatsappService');
const { evaluateMessage } = require('../../services/aiEvaluator');
const { getDb } = require('../../config/database');
const logger = require('../../utils/logger');

router.use(authenticateToken);

// ─── Stats ──────────────────────────────────────────────
router.get('/stats', (req, res) => {
  try {
    res.json({
      ...Chat.getStats(),
      ignored: Chat.countIgnored(),
      pendingActions: Action.countPending(),
      whatsappConnected: whatsappService.isConnected(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Responses list ─────────────────────────────────────
router.get('/responses', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;
    const responses = Chat.findResponses(limit, offset);

    // Parse stored JSON fields
    responses.forEach(r => {
      if (r.context_used && typeof r.context_used === 'string') {
        try { r.context_used = JSON.parse(r.context_used); } catch (_) {}
      }
      if (r.matched_faqs && typeof r.matched_faqs === 'string') {
        try { r.matched_faqs = JSON.parse(r.matched_faqs); } catch (_) {}
      }
    });

    const total = Chat.countResponses();
    res.json({ responses, total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Ignored messages ──────────────────────────────────
router.get('/ignored', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;
    const ignored = Chat.findIgnored(limit, offset);

    ignored.forEach(r => {
      if (r.context_used && typeof r.context_used === 'string') {
        try { r.context_used = JSON.parse(r.context_used); } catch (_) {}
      }
    });

    const total = Chat.countIgnored();
    res.json({ ignored, total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Actions ────────────────────────────────────────────
router.get('/actions', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;
    const actions = Action.findAll(limit, offset);

    actions.forEach(a => {
      if (a.details && typeof a.details === 'string') {
        try { a.details = JSON.parse(a.details); } catch (_) {}
      }
    });

    const total = Action.countAll();
    const pending = Action.countPending();
    res.json({ actions, total, pending });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/actions/:id/resolve', (req, res) => {
  try {
    const action = Action.findById(parseInt(req.params.id));
    if (!action) return res.status(404).json({ error: 'Not found' });
    if (action.status === 'resolved') return res.status(400).json({ error: 'Already resolved' });

    const updated = Action.resolve(action.id, 'admin');
    logger.info(`Resolved action ${action.id} (${action.action_type})`);
    res.json({ success: true, action: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Single response detail ─────────────────────────────
router.get('/responses/:id', (req, res) => {
  try {
    const chat = Chat.findById(parseInt(req.params.id));
    if (!chat) return res.status(404).json({ error: 'Not found' });

    if (chat.context_used && typeof chat.context_used === 'string') {
      try { chat.context_used = JSON.parse(chat.context_used); } catch (_) {}
    }
    if (chat.matched_faqs && typeof chat.matched_faqs === 'string') {
      try { chat.matched_faqs = JSON.parse(chat.matched_faqs); } catch (_) {}
    }

    res.json({ response: chat });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Manual send (test mode) ────────────────────────────
router.post('/responses/:id/send', async (req, res) => {
  try {
    const chat = Chat.findById(parseInt(req.params.id));
    if (!chat) return res.status(404).json({ error: 'Not found' });
    if (!chat.response) return res.status(400).json({ error: 'No response to send' });
    if (chat.response_sent) return res.status(400).json({ error: 'Already sent' });

    const responseText = (req.body && req.body.response) ? req.body.response.trim() : chat.response;

    if (req.body && req.body.response) {
      Chat.updateResponse(chat.id, responseText);
    }

    await whatsappService.sendMessageToGroup(chat.group_id, responseText, chat.whatsapp_msg_id);
    const updated = Chat.markSent(chat.id);
    logger.info(`Manually sent response for chat ${chat.id}`);
    res.json({ success: true, response: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Dismiss to ignored ─────────────────────────────────
router.post('/responses/:id/dismiss', (req, res) => {
  try {
    const chat = Chat.findById(parseInt(req.params.id));
    if (!chat) return res.status(404).json({ error: 'Not found' });
    if (chat.response_sent) return res.status(400).json({ error: 'Already sent' });

    Chat.saveClassification(chat.id, {
      classification: 'ignore',
      confidence: chat.confidence,
      response: null,
      reasoning: 'Manually dismissed by admin.',
      context_used: chat.context_used ? (typeof chat.context_used === 'string' ? JSON.parse(chat.context_used) : chat.context_used) : null,
      matched_faqs: null,
      status: 'ignored',
    });

    logger.info(`Dismissed chat ${chat.id} to ignored`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Re-evaluate with LLM ───────────────────────────────
router.post('/responses/:id/reevaluate', async (req, res) => {
  try {
    const chat = Chat.findById(parseInt(req.params.id));
    if (!chat) return res.status(404).json({ error: 'Not found' });
    if (chat.response_sent) return res.status(400).json({ error: 'Already sent — cannot re-evaluate' });

    // Get latest knowledge blob
    const db = getDb();
    const row = db.prepare("SELECT value FROM settings WHERE key = 'knowledge_base'").get();
    const knowledgeBlob = row ? row.value : '';

    // Rebuild context window from stored data
    let contextWindow = [];
    if (chat.context_used) {
      try { contextWindow = typeof chat.context_used === 'string' ? JSON.parse(chat.context_used) : chat.context_used; } catch (_) {}
    }

    const result = await evaluateMessage(chat.message, chat.sender_name, contextWindow, knowledgeBlob);

    // Update the record with fresh evaluation
    Chat.saveClassification(chat.id, {
      classification: result.shouldRespond ? 'answer' : 'ignore',
      confidence: result.confidence,
      response: result.response,
      reasoning: result.reasoning,
      context_used: contextWindow,
      matched_faqs: null,
      status: result.shouldRespond ? 'pending' : 'ignored',
    });

    const updated = Chat.findById(chat.id);
    if (updated.context_used && typeof updated.context_used === 'string') {
      try { updated.context_used = JSON.parse(updated.context_used); } catch (_) {}
    }

    logger.info(`Re-evaluated chat ${chat.id}: shouldRespond=${result.shouldRespond}`);
    res.json({ success: true, response: updated });
  } catch (err) {
    logger.error(`Re-evaluate failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ─── Mode ───────────────────────────────────────────────
router.get('/mode', (req, res) => {
  res.json({ mode: whatsappService.getMode(), group_name: whatsappService.getMonitoredGroupName() });
});

router.post('/mode', async (req, res) => {
  try {
    const { mode } = req.body;
    if (mode !== 'test' && mode !== 'prod') return res.status(400).json({ error: 'Invalid mode' });
    const result = await whatsappService.setMode(mode);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Admin Authors ──────────────────────────────────────
router.get('/admin-authors', (req, res) => {
  try {
    res.json({ authors: AdminAuthor.findAll() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/admin-authors', (req, res) => {
  try {
    const { sender_id, sender_name } = req.body;
    if (!sender_id) return res.status(400).json({ error: 'sender_id is required' });
    const author = AdminAuthor.add(sender_id.trim(), sender_name || null, req.user.username);
    res.status(201).json({ author });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/admin-authors/:id', (req, res) => {
  try {
    AdminAuthor.remove(parseInt(req.params.id));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Knowledge Base (text blob) ─────────────────────────
router.get('/knowledge', (req, res) => {
  try {
    const db = getDb();
    const row = db.prepare("SELECT value, updated_at FROM settings WHERE key = 'knowledge_base'").get();
    res.json({ content: row ? row.value : '', updated_at: row ? row.updated_at : null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/knowledge', (req, res) => {
  try {
    const { content } = req.body;
    if (content === undefined) return res.status(400).json({ error: 'content is required' });
    const db = getDb();
    db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES ('knowledge_base', ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`).run(content);
    res.json({ success: true, length: content.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Test / Simulate ────────────────────────────────────
router.post('/test', async (req, res) => {
  try {
    const { message, sender_name } = req.body;
    if (!message) return res.status(400).json({ error: 'message is required' });

    const name = sender_name || 'Test User';

    // Build a context window from recent DB messages (if any exist)
    const recentMessages = Chat.findRecentByGroup(null, 30);
    const contextWindow = recentMessages.map(m => ({
      sender_name: m.sender_name,
      message: m.message,
      same_sender: false,
      created_at: m.created_at,
    }));

    // Get knowledge blob
    const db = getDb();
    const row = db.prepare("SELECT value FROM settings WHERE key = 'knowledge_base'").get();
    const knowledgeBlob = row ? row.value : '';

    const result = await evaluateMessage(message, name, contextWindow, knowledgeBlob);

    res.json({
      action: result.action || (result.shouldRespond ? 'answer' : 'ignore'),
      shouldRespond: result.shouldRespond,
      confidence: result.confidence,
      response: result.response,
      reasoning: result.reasoning,
      contextWindowSize: contextWindow.length,
    });
  } catch (err) {
    logger.error(`Test endpoint failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
