const Chat = require('../models/Chat');
const FAQ = require('../models/FAQ');
const { humanDelay, typingDelay } = require('../utils/delay');
const logger = require('../utils/logger');

let io = null;

function setSocketIO(socketIO) {
  io = socketIO;
}

async function sendWhatsAppResponse(whatsappChat, chatRecord, responseText) {
  try {
    // Wait 45-75 seconds to appear human
    await humanDelay();

    // Simulate typing
    await typingDelay(whatsappChat);

    // Send the message
    await whatsappChat.sendMessage(responseText);

    // Update DB
    Chat.markResponseSent(chatRecord.id);
    logger.info(`Response sent for chat ${chatRecord.id}`);

    // Notify dashboard
    if (io) {
      io.emit('response_sent', {
        chatId: chatRecord.id,
        response: responseText,
        timestamp: new Date().toISOString(),
      });
    }

    return true;
  } catch (err) {
    logger.error(`Failed to send response for chat ${chatRecord.id}: ${err.message}`);
    return false;
  }
}

async function processClassification(whatsappChat, chatRecord, classification) {
  const { classifyMessage } = require('./aiEvaluator');
  const { handleAction } = require('./actionHandler');

  // Update chat record with classification
  Chat.updateClassification(chatRecord.id, {
    classification: classification.classification,
    confidence: classification.confidence,
    response: classification.response,
    status: classification.classification === 'faq' ? 'responded' : 'pending',
  });

  // Notify dashboard of new message
  if (io) {
    io.emit('new_message', {
      chat: Chat.findById(chatRecord.id),
      classification,
    });
  }

  switch (classification.classification) {
    case 'faq':
      if (classification.response && classification.confidence >= 0.6) {
        await sendWhatsAppResponse(whatsappChat, chatRecord, classification.response);

        // Track which FAQ was used
        const faqs = FAQ.findActive();
        for (const faq of faqs) {
          if (classification.response.includes(faq.answer.substring(0, 50))) {
            FAQ.incrementUsage(faq.id);
            break;
          }
        }
      } else {
        Chat.updateStatus(chatRecord.id, 'pending');
        logger.info(`FAQ match confidence too low (${classification.confidence}) — sent to dashboard`);
      }
      break;

    case 'action':
      const action = await handleAction(chatRecord, classification);
      Chat.updateStatus(chatRecord.id, 'pending');
      logger.info(`Action request tracked for dashboard review: ${classification.action_type}`);

      if (io) {
        io.emit('new_action', { action, chat: chatRecord });
      }
      break;

    case 'unknown':
    default:
      Chat.updateStatus(chatRecord.id, 'pending');
      logger.info(`Unknown message sent to dashboard for review: "${chatRecord.message.substring(0, 80)}"`);
      break;
  }
}

module.exports = { sendWhatsAppResponse, processClassification, setSocketIO };
