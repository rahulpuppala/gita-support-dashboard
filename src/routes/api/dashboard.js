const express = require('express');
const router = express.Router();
const Chat = require('../../models/Chat');
const Action = require('../../models/Action');
const FAQ = require('../../models/FAQ');
const { authenticateToken } = require('../../middleware/auth');
const whatsappService = require('../../services/whatsappService');

router.use(authenticateToken);

router.get('/stats', (req, res) => {
  try {
    const chatStats = Chat.getStats();
    const actionStats = Action.getStats();
    const faqCount = FAQ.findActive().length;

    res.json({
      chats: chatStats,
      actions: actionStats,
      faqCount,
      whatsappConnected: whatsappService.isConnected(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/recent', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;
    const chats = Chat.findAll(limit, offset);
    res.json({ chats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/mode', (req, res) => {
  try {
    res.json({
      mode: whatsappService.getMode(),
      group_name: whatsappService.getMonitoredGroupName(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/mode', async (req, res) => {
  try {
    const { mode } = req.body;
    if (mode !== 'test' && mode !== 'prod') {
      return res.status(400).json({ error: 'Mode must be "test" or "prod"' });
    }
    const result = await whatsappService.setMode(mode);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
