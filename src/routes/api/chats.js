const express = require('express');
const router = express.Router();
const Chat = require('../../models/Chat');
const { authenticateToken } = require('../../middleware/auth');
const whatsappService = require('../../services/whatsappService');
const { humanDelay } = require('../../utils/delay');
const logger = require('../../utils/logger');

router.use(authenticateToken);

router.get('/', (req, res) => {
  try {
    const { classification, status, search, limit, offset } = req.query;
    let chats;

    if (search) {
      chats = Chat.search(search, parseInt(limit) || 50);
    } else if (classification) {
      chats = Chat.findByClassification(classification, parseInt(limit) || 50, parseInt(offset) || 0);
    } else if (status === 'pending') {
      chats = Chat.findPending(parseInt(limit) || 50, parseInt(offset) || 0);
    } else {
      chats = Chat.findAll(parseInt(limit) || 50, parseInt(offset) || 0);
    }

    res.json({ chats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', (req, res) => {
  try {
    const chat = Chat.findById(req.params.id);
    if (!chat) return res.status(404).json({ error: 'Chat not found' });
    res.json({ chat });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/respond', async (req, res) => {
  try {
    const chat = Chat.findById(req.params.id);
    if (!chat) return res.status(404).json({ error: 'Chat not found' });

    const { response } = req.body;
    if (!response) return res.status(400).json({ error: 'Response text required' });

    // Update chat with manual response
    Chat.updateClassification(chat.id, {
      classification: chat.classification || 'manual',
      confidence: 1.0,
      response,
      status: 'responded',
    });

    // Send via WhatsApp if connected and it's a WhatsApp message
    if (chat.source === 'whatsapp' && whatsappService.isConnected() && chat.group_id) {
      try {
        await whatsappService.sendMessageToGroup(chat.group_id, response);
        Chat.markResponseSent(chat.id);
        logger.info(`Admin manually responded to chat ${chat.id} via WhatsApp`);
      } catch (sendErr) {
        logger.error(`Failed to send manual response via WhatsApp: ${sendErr.message}`);
      }
    }

    res.json({ chat: Chat.findById(chat.id), message: 'Response sent' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id/status', (req, res) => {
  try {
    const { status } = req.body;
    if (!['pending', 'responded', 'escalated', 'ignored'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    Chat.updateStatus(req.params.id, status);
    res.json({ chat: Chat.findById(req.params.id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', (req, res) => {
  try {
    const chat = Chat.findById(req.params.id);
    if (!chat) return res.status(404).json({ error: 'Chat not found' });
    Chat.delete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
