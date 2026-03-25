const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const path = require('path');
const Chat = require('../models/Chat');
const { classifyMessage } = require('./aiEvaluator');
const { processClassification } = require('./responseService');
const logger = require('../utils/logger');

let client = null;
let isReady = false;
let monitoredGroupId = null;
let currentMode = 'test';

const GROUP_NAMES = {
  test: 'CGS chat test',
  prod: 'CGS Webex Hosts Only',
};

function getClient() {
  return client;
}

function isConnected() {
  return isReady;
}

function getMode() {
  return currentMode;
}

function getMonitoredGroupName() {
  return GROUP_NAMES[currentMode];
}

async function setMode(mode) {
  if (mode !== 'test' && mode !== 'prod') throw new Error('Invalid mode');
  currentMode = mode;

  // Look up group ID by name
  if (client && isReady) {
    const chats = await client.getChats();
    const group = chats.find((c) => c.isGroup && c.name === GROUP_NAMES[mode]);
    if (group) {
      monitoredGroupId = group.id._serialized;
      logger.info(`Switched to ${mode} mode — monitoring "${GROUP_NAMES[mode]}" (${monitoredGroupId})`);
    } else {
      logger.warn(`Could not find group "${GROUP_NAMES[mode]}" — mode set to ${mode} but no group matched`);
      monitoredGroupId = null;
    }
  } else {
    logger.info(`Mode set to ${mode} — will resolve group when WhatsApp connects`);
  }

  return { mode: currentMode, group_name: GROUP_NAMES[mode], group_id: monitoredGroupId };
}

async function initialize(io) {
  const sessionPath = process.env.WHATSAPP_SESSION_PATH || path.join(__dirname, '../../sessions/whatsapp');

  client = new Client({
    authStrategy: new LocalAuth({ dataPath: sessionPath }),
    puppeteer: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--disable-gpu',
      ],
    },
  });

  client.on('qr', (qr) => {
    logger.info('QR code received — scan with WhatsApp:');
    qrcode.generate(qr, { small: true });
    if (io) {
      io.emit('whatsapp_qr', { qr });
    }
  });

  client.on('ready', async () => {
    isReady = true;
    logger.info('WhatsApp client is ready');

    if (io) {
      io.emit('whatsapp_status', { status: 'connected' });
    }

    // Resolve group by current mode
    await setMode(currentMode);
  });

  client.on('authenticated', () => {
    logger.info('WhatsApp authenticated successfully');
  });

  client.on('auth_failure', (msg) => {
    logger.error(`WhatsApp authentication failed: ${msg}`);
    if (io) {
      io.emit('whatsapp_status', { status: 'auth_failed', error: msg });
    }
  });

  client.on('disconnected', (reason) => {
    isReady = false;
    logger.warn(`WhatsApp disconnected: ${reason}`);
    if (io) {
      io.emit('whatsapp_status', { status: 'disconnected', reason });
    }

    // Attempt reconnection after 30 seconds
    setTimeout(() => {
      logger.info('Attempting WhatsApp reconnection...');
      client.initialize().catch((err) => {
        logger.error(`Reconnection failed: ${err.message}`);
      });
    }, 30000);
  });

  client.on('message', async (msg) => {
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
  // Ignore messages from self
  if (msg.fromMe) return;

  // Get chat info
  const chat = await msg.getChat();

  // Only process group messages if a monitored group is set
  if (monitoredGroupId) {
    if (!chat.isGroup || chat.id._serialized !== monitoredGroupId) {
      return;
    }
  } else if (!chat.isGroup) {
    // If no specific group set, still only monitor groups
    return;
  }

  // Ignore messages from group admins
  const senderId = msg.author || msg.from;
  const participant = chat.participants.find((p) => p.id._serialized === senderId);
  if (participant && (participant.isAdmin || participant.isSuperAdmin)) {
    return;
  }

  // Only process text messages
  if (msg.type !== 'chat') return;

  const contact = await msg.getContact();
  const senderName = contact.pushname || contact.name || contact.number;

  logger.info(`[${chat.name}] ${senderName}: ${msg.body.substring(0, 100)}`);

  // Store the chat message
  const chatRecord = Chat.create({
    source: 'whatsapp',
    group_id: chat.id._serialized,
    group_name: chat.name,
    sender_id: msg.author || msg.from,
    sender_name: senderName,
    message: msg.body,
    message_type: msg.type,
  });

  // Classify the message using AI
  const classification = await classifyMessage(msg.body);

  // Process based on classification
  await processClassification(chat, chatRecord, classification);
}

async function sendMessageToGroup(groupId, message) {
  if (!client || !isReady) {
    throw new Error('WhatsApp client not connected');
  }
  const chat = await client.getChatById(groupId);
  await chat.sendMessage(message);
  logger.info(`Sent message to group ${groupId}`);
}

async function getGroupInfo(groupId) {
  if (!client || !isReady) {
    throw new Error('WhatsApp client not connected');
  }
  const chat = await client.getChatById(groupId);
  if (!chat.isGroup) throw new Error('Not a group chat');

  return {
    id: chat.id._serialized,
    name: chat.name,
    description: chat.description,
    participants: chat.participants.map((p) => ({
      id: p.id._serialized,
      isAdmin: p.isAdmin,
      isSuperAdmin: p.isSuperAdmin,
    })),
    participantCount: chat.participants.length,
  };
}

module.exports = { initialize, getClient, isConnected, getMode, setMode, getMonitoredGroupName, sendMessageToGroup, getGroupInfo };
