const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { generateToken, authenticateToken } = require('../middleware/auth');
const { getAuthUrl, handleCallback, isAuthorized, revokeTokens } = require('../services/gmailAuth');
const logger = require('../utils/logger');

router.post('/login', (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const user = User.findByUsername(username);
    if (!user || !User.validatePassword(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (!user.is_active) {
      return res.status(403).json({ error: 'Account is disabled' });
    }

    User.updateLastLogin(user.id);
    const token = generateToken(user);

    logger.info(`User ${username} logged in`);
    res.json({
      token,
      user: { id: user.id, username: user.username, email: user.email, role: user.role },
    });
  } catch (err) {
    logger.error(`Login error: ${err.message}`);
    res.status(500).json({ error: 'Login failed' });
  }
});

router.get('/me', authenticateToken, (req, res) => {
  const user = User.findById(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user });
});

// ─── Gmail OAuth2 ───────────────────────────────────────
router.get('/gmail', (req, res) => {
  const url = getAuthUrl();
  if (!url) return res.status(500).json({ error: 'Gmail OAuth2 not configured — check GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET' });
  res.redirect(url);
});

router.get('/gmail/callback', async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) return res.status(400).send('Missing authorization code');
    await handleCallback(code);
    logger.info('Gmail OAuth2 authorization complete');
    res.send('<html><body style="font-family:sans-serif;text-align:center;padding:60px"><h2>Gmail Connected!</h2><p>You can close this tab and return to the dashboard.</p></body></html>');
  } catch (err) {
    logger.error(`Gmail OAuth callback failed: ${err.message}`);
    res.status(500).send(`Authorization failed: ${err.message}`);
  }
});

router.get('/gmail/status', authenticateToken, (req, res) => {
  res.json({ connected: isAuthorized() });
});

router.post('/gmail/disconnect', authenticateToken, (req, res) => {
  revokeTokens();
  res.json({ success: true, message: 'Gmail disconnected' });
});

module.exports = router;
