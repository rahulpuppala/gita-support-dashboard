const { getGmailClient, isAuthorized } = require('./gmailAuth');
const { getDb } = require('../config/database');
const Email = require('../models/Email');
const logger = require('../utils/logger');

// ─── Label Management ───────────────────────────────────
const LABEL_NAMES = {
  processed: 'SevaBot/Processed',
  failed: 'SevaBot/Failed',
  actionRequired: 'SevaBot/ActionRequired',
  draftCreated: 'SevaBot/DraftCreated',
};

const labelIdCache = {};

async function ensureLabel(gmail, labelName) {
  if (labelIdCache[labelName]) return labelIdCache[labelName];

  try {
    const res = await gmail.users.labels.list({ userId: 'me' });
    const existing = res.data.labels.find(l => l.name === labelName);
    if (existing) {
      labelIdCache[labelName] = existing.id;
      return existing.id;
    }

    const created = await gmail.users.labels.create({
      userId: 'me',
      requestBody: {
        name: labelName,
        labelListVisibility: 'labelShow',
        messageListVisibility: 'show',
      },
    });
    labelIdCache[labelName] = created.data.id;
    logger.info(`Created Gmail label: ${labelName}`);
    return created.data.id;
  } catch (err) {
    logger.error(`Failed to ensure label ${labelName}: ${err.message}`);
    return null;
  }
}

async function addLabel(gmail, messageId, labelKey) {
  const labelName = LABEL_NAMES[labelKey] || labelKey;
  const labelId = await ensureLabel(gmail, labelName);
  if (!labelId) return;

  try {
    await gmail.users.messages.modify({
      userId: 'me',
      id: messageId,
      requestBody: { addLabelIds: [labelId] },
    });
  } catch (err) {
    logger.error(`Failed to add label ${labelName} to ${messageId}: ${err.message}`);
  }
}

// ─── Parse Email ────────────────────────────────────────
function parseEmailMessage(msg) {
  const headers = msg.data.payload.headers || [];
  const getHeader = (name) => {
    const h = headers.find(h => h.name.toLowerCase() === name.toLowerCase());
    return h ? h.value : null;
  };

  const fromRaw = getHeader('From') || '';
  const fromMatch = fromRaw.match(/^(.+?)\s*<(.+?)>$/);
  const from_name = fromMatch ? fromMatch[1].replace(/"/g, '').trim() : fromRaw;
  const from_address = fromMatch ? fromMatch[2] : fromRaw;

  // Extract body text
  let body_text = '';
  const payload = msg.data.payload;

  function extractText(part) {
    if (part.mimeType === 'text/plain' && part.body && part.body.data) {
      return Buffer.from(part.body.data, 'base64').toString('utf-8');
    }
    if (part.parts) {
      for (const p of part.parts) {
        const text = extractText(p);
        if (text) return text;
      }
    }
    return '';
  }

  body_text = extractText(payload);

  // Fallback: try HTML if no plain text
  if (!body_text) {
    function extractHtml(part) {
      if (part.mimeType === 'text/html' && part.body && part.body.data) {
        const html = Buffer.from(part.body.data, 'base64').toString('utf-8');
        return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      }
      if (part.parts) {
        for (const p of part.parts) {
          const text = extractHtml(p);
          if (text) return text;
        }
      }
      return '';
    }
    body_text = extractHtml(payload);
  }

  const internalDate = msg.data.internalDate;
  const received_at = internalDate ? new Date(parseInt(internalDate)).toISOString() : null;

  return {
    gmail_msg_id: msg.data.id,
    gmail_thread_id: msg.data.threadId,
    from_address,
    from_name,
    to_address: getHeader('To') || '',
    subject: getHeader('Subject') || '(no subject)',
    body_text: body_text.substring(0, 50000), // cap at 50k chars
    body_snippet: msg.data.snippet || '',
    received_at,
    labels: msg.data.labelIds || [],
  };
}

// ─── Fetch Emails ───────────────────────────────────────
let _polling = false;

async function fetchNewEmails() {
  if (!isAuthorized()) throw new Error('Gmail not authorized');
  if (_polling) { logger.info('Email poll already running — skipping'); return []; }
  _polling = true;

  try {
    const gmail = getGmailClient();
    const db = getDb();
    const lastSyncRow = db.prepare("SELECT value FROM settings WHERE key = 'gmail_last_sync'").get();
    const lastSync = lastSyncRow ? lastSyncRow.value : null;

    let query = 'in:inbox';
    if (lastSync) {
      const epoch = Math.floor(new Date(lastSync).getTime() / 1000);
      query += ` after:${epoch}`;
    } else {
      // First run: only fetch last 5 minutes, not the entire inbox
      const fiveMinAgo = Math.floor((Date.now() - 5 * 60 * 1000) / 1000);
      query += ` after:${fiveMinAgo}`;
    }

    return await fetchEmailsByQuery(gmail, query);
  } finally {
    _polling = false;
  }
}

async function fetchEmailsByDateRange(startDate, endDate, { unreadOnly = false } = {}) {
  if (!isAuthorized()) throw new Error('Gmail not authorized');
  const gmail = getGmailClient();

  const afterEpoch = Math.floor(new Date(startDate).getTime() / 1000);
  const beforeEpoch = Math.floor(new Date(endDate).getTime() / 1000);
  let query = `in:inbox after:${afterEpoch} before:${beforeEpoch}`;
  if (unreadOnly) query += ' is:unread';

  return await fetchEmailsByQuery(gmail, query);
}

async function fetchEmailsByQuery(gmail, query) {
  const allMessages = [];
  let pageToken = null;

  do {
    const listParams = { userId: 'me', q: query, maxResults: 100 };
    if (pageToken) listParams.pageToken = pageToken;

    const res = await gmail.users.messages.list(listParams);
    const messages = res.data.messages || [];
    allMessages.push(...messages);
    pageToken = res.data.nextPageToken;
  } while (pageToken);

  logger.info(`Gmail query "${query}" found ${allMessages.length} messages`);

  const newEmails = [];
  for (const m of allMessages) {
    // Skip already-ingested emails
    if (Email.findByGmailMsgId(m.id)) continue;

    try {
      const full = await gmail.users.messages.get({ userId: 'me', id: m.id, format: 'full' });
      const parsed = parseEmailMessage(full);
      const record = Email.createSafe(parsed);
      if (record) newEmails.push(record);
    } catch (err) {
      if (!err.message?.includes('UNIQUE constraint')) {
        logger.error(`Failed to fetch message ${m.id}: ${err.message}`);
      }
    }
  }

  // Update last sync time
  const db = getDb();
  db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES ('gmail_last_sync', ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `).run(new Date().toISOString());

  logger.info(`Ingested ${newEmails.length} new emails`);
  return newEmails;
}

// ─── Create Draft Reply ─────────────────────────────────
async function createDraftReply(emailId, replyBody) {
  if (!isAuthorized()) throw new Error('Gmail not authorized');
  const gmail = getGmailClient();

  const email = Email.findById(emailId);
  if (!email) throw new Error('Email not found');

  const subject = email.subject.startsWith('Re:') ? email.subject : `Re: ${email.subject}`;
  const to = email.from_address;

  const rawMessage = [
    `To: ${to}`,
    `Subject: ${subject}`,
    `In-Reply-To: ${email.gmail_msg_id}`,
    `References: ${email.gmail_msg_id}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    replyBody,
  ].join('\r\n');

  const encodedMessage = Buffer.from(rawMessage).toString('base64url');

  const draft = await gmail.users.drafts.create({
    userId: 'me',
    requestBody: {
      message: {
        raw: encodedMessage,
        threadId: email.gmail_thread_id,
      },
    },
  });

  const draftId = draft.data.id;
  Email.updateDraftId(emailId, draftId);
  await addLabel(gmail, email.gmail_msg_id, 'draftCreated');

  logger.info(`Created Gmail draft ${draftId} for email ${emailId}`);
  return draftId;
}

// ─── Send Draft ─────────────────────────────────────────
async function sendDraft(emailId) {
  if (!isAuthorized()) throw new Error('Gmail not authorized');
  const gmail = getGmailClient();

  const email = Email.findById(emailId);
  if (!email) throw new Error('Email not found');
  if (!email.gmail_draft_id) throw new Error('No draft exists for this email');

  await gmail.users.drafts.send({
    userId: 'me',
    requestBody: { id: email.gmail_draft_id },
  });

  Email.markSent(emailId);
  await addLabel(gmail, email.gmail_msg_id, 'processed');

  logger.info(`Sent draft for email ${emailId}`);
  return Email.findById(emailId);
}

// ─── Update Existing Draft ──────────────────────────────
async function updateDraft(emailId, newReplyBody) {
  if (!isAuthorized()) throw new Error('Gmail not authorized');
  const gmail = getGmailClient();

  const email = Email.findById(emailId);
  if (!email) throw new Error('Email not found');

  // Delete old draft if exists
  if (email.gmail_draft_id) {
    try {
      await gmail.users.drafts.delete({ userId: 'me', id: email.gmail_draft_id });
    } catch (err) {
      logger.warn(`Could not delete old draft ${email.gmail_draft_id}: ${err.message}`);
    }
  }

  // Update response in DB
  Email.updateResponse(emailId, newReplyBody);

  // Create new draft
  return await createDraftReply(emailId, newReplyBody);
}

// ─── Label Helpers ──────────────────────────────────────
async function labelProcessed(gmailMsgId) {
  if (!isAuthorized()) return;
  const gmail = getGmailClient();
  await addLabel(gmail, gmailMsgId, 'processed');
}

async function labelFailed(gmailMsgId) {
  if (!isAuthorized()) return;
  const gmail = getGmailClient();
  await addLabel(gmail, gmailMsgId, 'failed');
}

async function labelActionRequired(gmailMsgId) {
  if (!isAuthorized()) return;
  const gmail = getGmailClient();
  await addLabel(gmail, gmailMsgId, 'actionRequired');
}

module.exports = {
  fetchNewEmails,
  fetchEmailsByDateRange,
  createDraftReply,
  sendDraft,
  updateDraft,
  labelProcessed,
  labelFailed,
  labelActionRequired,
  parseEmailMessage,
};
