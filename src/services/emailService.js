const Imap = require('imap');
const { simpleParser } = require('mailparser');
const Chat = require('../models/Chat');
const { classifyMessage } = require('./aiEvaluator');
const { handleAction } = require('./actionHandler');
const logger = require('../utils/logger');

let imapClient = null;
let io = null;

function setSocketIO(socketIO) {
  io = socketIO;
}

const PLACEHOLDER_VALUES = ['your_email@gmail.com', 'your_app_password', 'your_email', 'your_pass'];
let retryCount = 0;
const MAX_RETRIES = 3;

function isPlaceholder(val) {
  return !val || PLACEHOLDER_VALUES.some((p) => val.toLowerCase().includes(p));
}

function initialize() {
  const host = process.env.EMAIL_HOST;
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;
  const port = parseInt(process.env.EMAIL_PORT) || 993;

  if (!host || !user || !pass || isPlaceholder(user) || isPlaceholder(pass)) {
    logger.warn('Email credentials not configured or still using placeholders — email monitoring disabled');
    return;
  }

  retryCount = 0;
  createAndConnect({ host, user, pass, port });
}

function createAndConnect({ host, user, pass, port }) {
  imapClient = new Imap({
    user,
    password: pass,
    host,
    port,
    tls: true,
    tlsOptions: { rejectUnauthorized: false },
  });

  imapClient.once('ready', () => {
    retryCount = 0;
    logger.info('Email IMAP connection ready');
    openInbox();
  });

  imapClient.on('error', (err) => {
    logger.error(`IMAP error: ${err.message}`);
  });

  imapClient.once('end', () => {
    logger.info('IMAP connection ended');
    retryCount++;
    if (retryCount > MAX_RETRIES) {
      logger.error(`IMAP max retries (${MAX_RETRIES}) reached — email monitoring stopped. Check your credentials.`);
      return;
    }
    setTimeout(() => {
      logger.info(`Reconnecting IMAP (attempt ${retryCount}/${MAX_RETRIES})...`);
      createAndConnect({ host, user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS, port });
    }, 60000);
  });

  imapClient.connect();
}

function openInbox() {
  imapClient.openBox('INBOX', false, (err) => {
    if (err) {
      logger.error(`Failed to open inbox: ${err.message}`);
      return;
    }
    logger.info('Email inbox opened — listening for new emails');

    // Listen for new emails
    imapClient.on('mail', () => {
      fetchUnseenEmails();
    });

    // Process any existing unseen emails
    fetchUnseenEmails();
  });
}

function fetchUnseenEmails() {
  imapClient.search(['UNSEEN'], (err, results) => {
    if (err) {
      logger.error(`Email search error: ${err.message}`);
      return;
    }
    if (!results || results.length === 0) return;

    const fetch = imapClient.fetch(results, { bodies: '', markSeen: true });

    fetch.on('message', (msg) => {
      msg.on('body', (stream) => {
        simpleParser(stream, async (parseErr, parsed) => {
          if (parseErr) {
            logger.error(`Email parse error: ${parseErr.message}`);
            return;
          }
          await processEmail(parsed);
        });
      });
    });

    fetch.once('error', (fetchErr) => {
      logger.error(`Email fetch error: ${fetchErr.message}`);
    });
  });
}

async function processEmail(parsed) {
  const sender = parsed.from?.value?.[0]?.address || 'unknown';
  const senderName = parsed.from?.value?.[0]?.name || sender;
  const subject = parsed.subject || '(no subject)';
  const body = parsed.text || parsed.html || '';

  const messageText = `[Email] Subject: ${subject}\n${body}`.substring(0, 2000);

  logger.info(`Processing email from ${senderName}: ${subject}`);

  // Store as chat
  const chatRecord = Chat.create({
    source: 'email',
    group_id: 'email',
    group_name: 'Email Inbox',
    sender_id: sender,
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

  // Notify dashboard
  if (io) {
    io.emit('new_message', {
      chat: Chat.findById(chatRecord.id),
      classification,
    });
  }

  logger.info(`Email classified as "${classification.classification}" — ${subject}`);
}

module.exports = { initialize, setSocketIO };
