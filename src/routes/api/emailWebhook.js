const express = require('express');
const router = express.Router();
const Chat = require('../../models/Chat');
const { classifyMessage } = require('../../services/aiEvaluator');
const { handleAction } = require('../../services/actionHandler');
const logger = require('../../utils/logger');

let io = null;

function setSocketIO(socketIO) {
  io = socketIO;
}

// POST /api/email/inbound
// Google Apps Script forwards emails here
// Expected body: { from, fromName, subject, body, timestamp? }
router.post('/inbound', async (req, res) => {
  try {
    const { from, fromName, subject, body, timestamp } = req.body;

    if (!from || !body) {
      return res.status(400).json({ error: 'Missing required fields: from, body' });
    }

    const senderName = fromName || from;
    const messageText = `[Email] Subject: ${subject || '(no subject)'}\n${body}`.substring(0, 2000);

    logger.info(`Inbound email webhook from ${senderName}: ${subject || '(no subject)'}`);

    // Store as chat
    const chatRecord = Chat.create({
      source: 'email',
      group_id: 'email',
      group_name: 'Email Inbox',
      sender_id: from,
      sender_name: senderName,
      message: messageText,
      message_type: 'email',
    });

    // Classify
    const classification = await classifyMessage(messageText);

    Chat.updateClassification(chatRecord.id, {
      classification: classification.classification,
      confidence: classification.confidence,
      response: classification.response,
      status: classification.classification === 'unknown' ? 'pending' : 'responded',
    });

    if (classification.classification === 'action') {
      await handleAction(chatRecord, classification);
    }

    // Notify dashboard via Socket.IO
    if (io) {
      io.emit('new_message', {
        chat: Chat.findById(chatRecord.id),
        classification,
      });
    }

    logger.info(`Email classified as "${classification.classification}" — ${subject || '(no subject)'}`);

    res.json({
      success: true,
      chatId: chatRecord.id,
      classification: classification.classification,
    });
  } catch (err) {
    logger.error(`Email webhook error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.setSocketIO = setSocketIO;
