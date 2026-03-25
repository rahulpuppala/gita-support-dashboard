const express = require('express');
const router = express.Router();
const { classifyMessage } = require('../../services/aiEvaluator');
const Chat = require('../../models/Chat');
const Action = require('../../models/Action');
const { authenticateToken } = require('../../middleware/auth');
const logger = require('../../utils/logger');

let io = null;
function setSocketIO(socketIO) { io = socketIO; }

router.use(authenticateToken);

// Simulate a message through the classification pipeline (no WhatsApp interaction)
router.post('/classify', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const startTime = Date.now();
    const result = await classifyMessage(message.trim());
    const duration = Date.now() - startTime;

    // Store in DB so it appears in dashboard tabs
    const chatRecord = Chat.create({
      source: 'simulator',
      group_id: 'simulator',
      group_name: 'Simulator',
      sender_id: 'simulator',
      sender_name: 'Simulator User',
      message: message.trim(),
      message_type: 'text',
    });

    Chat.updateClassification(chatRecord.id, {
      classification: result.classification,
      confidence: result.confidence,
      response: result.response,
      status: result.classification === 'faq' ? 'responded' : 'pending',
    });

    let actionRecord = null;
    if (result.classification === 'action' && result.action_type) {
      actionRecord = Action.create({
        chat_id: chatRecord.id,
        action_type: result.action_type,
        action_data: {
          sender_id: null,
          sender_name: 'Simulator User',
          group_id: null,
          group_name: 'Simulator',
          message: message.trim(),
          phone: null,
          email: result.extracted_email || null,
        },
        priority: result.action_type === 'remove_host' ? 2 : 1,
      });
    }

    // Emit socket events so dashboard tabs update live
    if (io) {
      const updatedChat = Chat.findById(chatRecord.id);
      io.emit('new_message', { chat: updatedChat, classification: result });
      if (actionRecord) {
        io.emit('new_action', { action: actionRecord, chat: updatedChat });
      }
    }

    res.json({
      message: message.trim(),
      ...result,
      chat_id: chatRecord.id,
      action_id: actionRecord ? actionRecord.id : null,
      duration_ms: duration,
    });
  } catch (err) {
    logger.error(`Simulator error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// Backtest: re-classify existing messages with the current knowledge base
router.post('/backtest', async (req, res) => {
  try {
    const { limit = 50, classification } = req.body;
    const cap = Math.min(parseInt(limit) || 50, 200);

    let messages;
    if (classification) {
      messages = Chat.findByClassification(classification, cap, 0);
    } else {
      messages = Chat.findAll(cap, 0);
    }

    if (messages.length === 0) {
      return res.json({ results: [], summary: { total: 0 } });
    }

    const results = [];
    for (const msg of messages) {
      const startTime = Date.now();
      const newResult = await classifyMessage(msg.message);
      const duration = Date.now() - startTime;

      results.push({
        chat_id: msg.id,
        message: msg.message,
        sender_name: msg.sender_name,
        original: {
          classification: msg.classification,
          confidence: msg.confidence,
          response: msg.response,
        },
        new: {
          classification: newResult.classification,
          confidence: newResult.confidence,
          response: newResult.response,
          action_type: newResult.action_type,
          reasoning: newResult.reasoning,
        },
        changed: msg.classification !== newResult.classification,
        duration_ms: duration,
      });
    }

    const changed = results.filter((r) => r.changed).length;
    const summary = {
      total: results.length,
      changed,
      unchanged: results.length - changed,
      breakdown: {
        faq: results.filter((r) => r.new.classification === 'faq').length,
        action: results.filter((r) => r.new.classification === 'action').length,
        unknown: results.filter((r) => r.new.classification === 'unknown').length,
      },
    };

    res.json({ results, summary });
  } catch (err) {
    logger.error(`Backtest error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

router.setSocketIO = setSocketIO;
module.exports = router;
