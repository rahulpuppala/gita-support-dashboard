const logger = require('./logger');

const MIN_DELAY = parseInt(process.env.MIN_RESPONSE_DELAY) || 45000;
const MAX_DELAY = parseInt(process.env.MAX_RESPONSE_DELAY) || 75000;

function getRandomDelay() {
  return Math.floor(Math.random() * (MAX_DELAY - MIN_DELAY + 1)) + MIN_DELAY;
}

async function humanDelay() {
  const delay = getRandomDelay();
  logger.info(`Waiting ${(delay / 1000).toFixed(1)}s before responding (bot detection prevention)`);
  return new Promise((resolve) => setTimeout(resolve, delay));
}

async function typingDelay(chat, durationMs = 3000) {
  if (process.env.ENABLE_TYPING_INDICATOR === 'true') {
    try {
      await chat.sendStateTyping();
      await new Promise((resolve) => setTimeout(resolve, durationMs));
      await chat.clearState();
    } catch (err) {
      logger.warn('Failed to simulate typing indicator', err.message);
    }
  }
}

module.exports = { humanDelay, typingDelay, getRandomDelay };
