const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const path = require('path');
const Chat = require('../models/Chat');
const AdminAuthor = require('../models/AdminAuthor');
const Action = require('../models/Action');
const { evaluateMessage } = require('./aiEvaluator');
const { humanDelay, typingDelay } = require('../utils/delay');
const { getDb } = require('../config/database');
const logger = require('../utils/logger');

function getKnowledgeBlob() {
  const db = getDb();
  const row = db.prepare("SELECT value FROM settings WHERE key = 'knowledge_base'").get();
  return row ? row.value : '';
}

let client = null;
let isReady = false;
let monitoredGroupId = null;
let currentMode = 'test';
let socketIO = null;

const MONITORED_GROUP = 'CGS Webex Hosts Only';
const MIN_WORD_COUNT = 5;

function isConnected() { return isReady; }
function getMode() { return currentMode; }
function getMonitoredGroupName() { return MONITORED_GROUP; }

async function setMode(mode) {
  if (mode !== 'test' && mode !== 'prod') throw new Error('Invalid mode');
  currentMode = mode;

  if (client && isReady) {
    const chats = await client.getChats();
    const group = chats.find((c) => c.isGroup && c.name === MONITORED_GROUP);
    if (group) {
      monitoredGroupId = group.id._serialized;
      logger.info(`Switched to ${mode} mode — monitoring "${MONITORED_GROUP}"`);
    } else {
      logger.warn(`Could not find group "${MONITORED_GROUP}"`);
      monitoredGroupId = null;
    }
  }
  return { mode: currentMode, group_name: MONITORED_GROUP };
}

async function initialize(io) {
  socketIO = io;
  const sessionPath = process.env.WHATSAPP_SESSION_PATH || path.join(__dirname, '../../sessions/whatsapp');

  client = new Client({
    authStrategy: new LocalAuth({ dataPath: sessionPath }),
    puppeteer: {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    },
  });

  client.on('qr', (qr) => {
    logger.info('QR code received — scan with WhatsApp:');
    qrcode.generate(qr, { small: true });
    if (io) io.emit('whatsapp_qr', { qr });
  });

  client.on('ready', async () => {
    isReady = true;
    logger.info('WhatsApp client is ready');
    if (io) io.emit('whatsapp_status', { status: 'connected' });
    await setMode(currentMode);
  });

  client.on('authenticated', () => logger.info('WhatsApp authenticated'));

  client.on('auth_failure', (msg) => {
    logger.error(`WhatsApp auth failed: ${msg}`);
    if (io) io.emit('whatsapp_status', { status: 'auth_failed', error: msg });
  });

  client.on('disconnected', (reason) => {
    isReady = false;
    logger.warn(`WhatsApp disconnected: ${reason}`);
    if (io) io.emit('whatsapp_status', { status: 'disconnected', reason });
    setTimeout(() => {
      logger.info('Attempting WhatsApp reconnection...');
      client.initialize().catch(e => logger.error(`Reconnection failed: ${e.message}`));
    }, 30000);
  });

  client.on('message_create', async (msg) => {
    try {
      await handleIncomingMessage(msg);
    } catch (err) {
      logger.error(`Error handling message: ${err.message}`, { stack: err.stack });
    }
  });

  logger.info('Initializing WhatsApp client...');
  await client.initialize();
}

async function handleIncomingMessage(msg) {
  if (msg.fromMe) return;
  if (!msg.body || !msg.body.trim()) return;

  const chat = await msg.getChat();

  if (monitoredGroupId) {
    if (!chat.isGroup || chat.id._serialized !== monitoredGroupId) return;
  } else if (!chat.isGroup) {
    return;
  }

  const contact = await msg.getContact();
  const senderName = contact.pushname || contact.name || contact.number;
  const senderPhone = contact.id ? contact.id.user : (contact.number || null);

  // Check admin status
  const senderId = msg.author || msg.from;
  const participant = chat.participants.find((p) => p.id._serialized === senderId);
  const isWhatsAppAdmin = participant && (participant.isAdmin || participant.isSuperAdmin);
  const isMarkedAdmin = senderPhone ? AdminAuthor.isAdmin(senderPhone) : false;
  const isAdmin = isWhatsAppAdmin || isMarkedAdmin;

  // Dedup
  const whatsappMsgId = msg.id ? msg.id._serialized : null;
  if (whatsappMsgId && Chat.findByWhatsAppMsgId(whatsappMsgId)) return;

  // Store every message
  const chatRecord = Chat.create({
    source: 'whatsapp',
    group_id: chat.id._serialized,
    group_name: chat.name,
    sender_id: senderPhone || senderId,
    sender_name: senderName,
    message: msg.body,
    message_type: msg.type,
    whatsapp_msg_id: whatsappMsgId,
  });

  // --- FILTERS: skip without calling LLM ---
  if (isAdmin) {
    Chat.saveClassification(chatRecord.id, {
      classification: 'ignore',
      confidence: 1,
      response: null,
      reasoning: 'Admin author — messages from admins are automatically ignored.',
      context_used: null,
      matched_faqs: null,
      status: 'ignored',
    });
    logger.debug(`Ignored admin message from ${senderName}`);
    if (socketIO) socketIO.emit('new_ignored', { chat: Chat.findById(chatRecord.id) });
    return;
  }

  const wordCount = msg.body.trim().split(/\s+/).length;
  if (wordCount < MIN_WORD_COUNT) {
    Chat.saveClassification(chatRecord.id, {
      classification: 'ignore',
      confidence: 1,
      response: null,
      reasoning: `Too short (${wordCount} words) — minimum is ${MIN_WORD_COUNT}.`,
      context_used: null,
      matched_faqs: null,
      status: 'ignored',
    });
    logger.debug(`Ignored short message (${wordCount} words): "${msg.body.substring(0, 60)}"`);
    if (socketIO) socketIO.emit('new_ignored', { chat: Chat.findById(chatRecord.id) });
    return;
  }

  // --- BUILD CONTEXT WINDOW ---
  const recentMessages = Chat.findRecentByGroup(chat.id._serialized, 30);
  const contextWindow = recentMessages.map(m => ({
    sender_name: m.sender_name,
    message: m.message,
    same_sender: m.sender_id === (senderPhone || senderId),
    created_at: m.created_at,
  }));

  // --- EVALUATE WITH LLM ---
  const knowledgeBlob = getKnowledgeBlob();
  const result = await evaluateMessage(msg.body, senderName, contextWindow, knowledgeBlob);

  const action = result.action || (result.shouldRespond ? 'answer' : 'ignore');

  // --- IGNORE ---
  if (action === 'ignore') {
    Chat.saveClassification(chatRecord.id, {
      classification: 'ignore',
      confidence: result.confidence,
      response: null,
      reasoning: result.reasoning,
      context_used: contextWindow,
      matched_faqs: null,
      status: 'ignored',
    });
    logger.debug(`Ignored: "${msg.body.substring(0, 60)}" — ${result.reasoning}`);
    if (socketIO) socketIO.emit('new_ignored', { chat: Chat.findById(chatRecord.id) });
    return;
  }

  // --- ACTIONS: remove_host, list_participants ---
  if (action === 'remove_host') {
    const respondStatus = currentMode === 'prod' ? 'sent' : 'pending';
    Chat.saveClassification(chatRecord.id, {
      classification: action,
      confidence: result.confidence,
      response: result.response,
      reasoning: result.reasoning,
      context_used: contextWindow,
      matched_faqs: null,
      status: respondStatus,
    });

    const actionRecord = Action.create({
      chat_id: chatRecord.id,
      action_type: action,
      sender_id: senderPhone || senderId,
      sender_name: senderName,
      group_id: chat.id._serialized,
      details: { message: msg.body, reasoning: result.reasoning },
    });

    if (currentMode === 'prod' && result.response) {
      await humanDelay();
      await typingDelay(chat);
      const options = chatRecord.whatsapp_msg_id ? { quotedMessageId: chatRecord.whatsapp_msg_id } : {};
      await chat.sendMessage(result.response, options);
      Chat.markSent(chatRecord.id);
      logger.info(`Action response sent to ${senderName} (${action})`);
    } else {
      logger.info(`[test] Action saved: ${action} from ${senderName}`);
    }

    if (socketIO) {
      socketIO.emit('new_action', { action: actionRecord, chat: Chat.findById(chatRecord.id) });
      socketIO.emit('new_response', { chat: Chat.findById(chatRecord.id) });
    }
    return;
  }

  // --- ANSWER ---
  const status = currentMode === 'prod' ? 'sent' : 'pending';
  Chat.saveClassification(chatRecord.id, {
    classification: 'answer',
    confidence: result.confidence,
    response: result.response,
    reasoning: result.reasoning,
    context_used: contextWindow,
    matched_faqs: null,
    status,
  });

  if (currentMode === 'prod') {
    await humanDelay();
    await typingDelay(chat);
    const options = chatRecord.whatsapp_msg_id ? { quotedMessageId: chatRecord.whatsapp_msg_id } : {};
    await chat.sendMessage(result.response, options);
    Chat.markSent(chatRecord.id);
    logger.info(`Response sent to ${senderName}`);
  } else {
    logger.info(`[test] Response saved for review: "${msg.body.substring(0, 60)}"`);
  }

  if (socketIO) {
    socketIO.emit('new_response', { chat: Chat.findById(chatRecord.id) });
  }
}

async function sendMessageToGroup(groupId, message, quotedMsgId) {
  if (!client || !isReady) throw new Error('WhatsApp client not connected');
  const chat = await client.getChatById(groupId);
  const options = quotedMsgId ? { quotedMessageId: quotedMsgId } : {};
  await chat.sendMessage(message, options);
}

module.exports = { initialize, isConnected, getMode, setMode, getMonitoredGroupName, sendMessageToGroup };
