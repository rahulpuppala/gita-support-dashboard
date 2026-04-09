const { google } = require('googleapis');
const { getDb } = require('../config/database');
const logger = require('../utils/logger');

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.compose',
];

let oAuth2Client = null;

function getOAuth2Client() {
  if (oAuth2Client) return oAuth2Client;

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/auth/gmail/callback';

  if (!clientId || !clientSecret) {
    logger.warn('Gmail OAuth2 credentials not configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)');
    return null;
  }

  oAuth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

  // Try to load stored tokens
  const tokens = getStoredTokens();
  if (tokens) {
    oAuth2Client.setCredentials(tokens);
    logger.info('Gmail OAuth2 tokens loaded from database');
  }

  // Auto-refresh tokens
  oAuth2Client.on('tokens', (newTokens) => {
    const existing = getStoredTokens() || {};
    const merged = { ...existing, ...newTokens };
    storeTokens(merged);
    logger.info('Gmail OAuth2 tokens refreshed and saved');
  });

  return oAuth2Client;
}

function getAuthUrl() {
  const client = getOAuth2Client();
  if (!client) return null;

  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
  });
}

async function handleCallback(code) {
  const client = getOAuth2Client();
  if (!client) throw new Error('OAuth2 client not configured');

  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);
  storeTokens(tokens);
  logger.info('Gmail OAuth2 authorized successfully');
  return tokens;
}

function getStoredTokens() {
  try {
    const db = getDb();
    const row = db.prepare("SELECT value FROM settings WHERE key = 'gmail_tokens'").get();
    return row ? JSON.parse(row.value) : null;
  } catch {
    return null;
  }
}

function storeTokens(tokens) {
  const db = getDb();
  db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES ('gmail_tokens', ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `).run(JSON.stringify(tokens));
}

function revokeTokens() {
  const db = getDb();
  db.prepare("DELETE FROM settings WHERE key = 'gmail_tokens'").run();
  oAuth2Client = null;
  logger.info('Gmail OAuth2 tokens revoked');
}

function isAuthorized() {
  const client = getOAuth2Client();
  if (!client) return false;
  const tokens = getStoredTokens();
  return !!(tokens && tokens.refresh_token);
}

function getGmailClient() {
  const client = getOAuth2Client();
  if (!client) throw new Error('Gmail OAuth2 client not configured');
  if (!isAuthorized()) throw new Error('Gmail not authorized — complete OAuth flow first');
  return google.gmail({ version: 'v1', auth: client });
}

module.exports = {
  getOAuth2Client,
  getAuthUrl,
  handleCallback,
  revokeTokens,
  isAuthorized,
  getGmailClient,
};
