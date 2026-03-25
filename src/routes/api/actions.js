const express = require('express');
const router = express.Router();
const Action = require('../../models/Action');
const { executeAction } = require('../../services/actionHandler');
const whatsappService = require('../../services/whatsappService');
const { authenticateToken } = require('../../middleware/auth');
const logger = require('../../utils/logger');

router.use(authenticateToken);

router.get('/', (req, res) => {
  try {
    const { status, type, limit, offset } = req.query;
    let actions;

    if (status && type) {
      actions = Action.findByStatusAndType(status, type, parseInt(limit) || 50, parseInt(offset) || 0);
    } else if (status) {
      actions = Action.findByStatus(status, parseInt(limit) || 50, parseInt(offset) || 0);
    } else if (type) {
      actions = Action.findByType(type, parseInt(limit) || 50, parseInt(offset) || 0);
    } else {
      actions = Action.findAll(parseInt(limit) || 50, parseInt(offset) || 0);
    }

    // Parse action_data JSON for each action
    actions = actions.map((a) => {
      if (a.action_data && typeof a.action_data === 'string') {
        try { a.action_data = JSON.parse(a.action_data); } catch (_) {}
      }
      return a;
    });

    res.json({ actions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/stats', (req, res) => {
  try {
    res.json({ stats: Action.getStats() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', (req, res) => {
  try {
    const action = Action.findById(req.params.id);
    if (!action) return res.status(404).json({ error: 'Action not found' });
    res.json({ action });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/execute', async (req, res) => {
  try {
    const client = whatsappService.getClient();
    const result = await executeAction(parseInt(req.params.id), client);
    logger.info(`Admin executed action ${req.params.id}`);
    res.json({ result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/assign', (req, res) => {
  try {
    const action = Action.assignTo(parseInt(req.params.id), req.user.username);
    res.json({ action });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id/status', (req, res) => {
  try {
    const { status, result, error_message } = req.body;
    if (!['pending', 'processing', 'completed', 'failed'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    const action = Action.updateStatus(parseInt(req.params.id), status, result, error_message);
    res.json({ action });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id', (req, res) => {
  try {
    const action = Action.update(parseInt(req.params.id), req.body);
    if (!action) return res.status(404).json({ error: 'Action not found' });
    res.json({ action });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', (req, res) => {
  try {
    const action = Action.findById(parseInt(req.params.id));
    if (!action) return res.status(404).json({ error: 'Action not found' });
    Action.delete(parseInt(req.params.id));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/note', (req, res) => {
  try {
    const { note } = req.body;
    if (!note || !note.trim()) return res.status(400).json({ error: 'Note is required' });
    const action = Action.addNote(parseInt(req.params.id), note.trim());
    if (!action) return res.status(404).json({ error: 'Action not found' });
    res.json({ action });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
