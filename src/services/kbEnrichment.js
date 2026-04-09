const OpenAI = require('openai');
const Chat = require('../models/Chat');
const { getDb } = require('../config/database');
const logger = require('../utils/logger');

let openai = null;

function getClient() {
  if (!openai) {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openai;
}

function getKnowledgeBase() {
  const db = getDb();
  const row = db.prepare("SELECT value FROM settings WHERE key = 'knowledge_base'").get();
  return row ? row.value : '';
}

function saveKnowledgeBase(content) {
  const db = getDb();
  db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES ('knowledge_base', ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`).run(content);
}

function buildChatTranscript(messages) {
  return messages.map(m => {
    let line = `[${m.sender_name}]: ${m.message}`;
    if (m.response && m.classification === 'answer') {
      line += `\n[Bot Response]: ${m.response}`;
    }
    return line;
  }).join('\n');
}

async function enrichKnowledgeBase(days = 1) {
  const messages = Chat.findRecentDays(days);

  if (!messages.length) {
    logger.info(`KB enrichment: no messages found in the last ${days} day(s)`);
    return { added: false, reason: 'No messages found' };
  }

  // Filter to only messages that had admin responses or were answered
  const relevantMessages = messages.filter(m =>
    m.response && m.classification === 'answer'
  );

  if (!relevantMessages.length) {
    logger.info(`KB enrichment: no answered messages in the last ${days} day(s)`);
    return { added: false, reason: 'No answered messages found' };
  }

  const currentKB = getKnowledgeBase();
  const transcript = buildChatTranscript(messages);

  const prompt = `You are a knowledge base curator. Below is the current knowledge base and a recent chat transcript from a WhatsApp support group.

Your job: Extract any NEW, useful Q&A knowledge from the chat transcript that admins or the bot answered, and that is NOT already covered in the current knowledge base. Only add factual, reusable information that would help answer similar questions in the future.

## Current Knowledge Base
${currentKB || '(Empty — no existing knowledge yet.)'}

## Recent Chat Transcript (last ${days} day${days > 1 ? 's' : ''}, ${messages.length} messages)
${transcript}

## Rules
- Only extract information from messages where an admin or the bot provided an answer.
- Do NOT add information that is already in the knowledge base (even if worded differently).
- Do NOT add greetings, casual chat, or non-reusable information.
- Format each new item as "Q: [question]\\nA: [answer]" pairs.
- If there is nothing new to add, respond with exactly: NOTHING_NEW
- If there are new items, respond with ONLY the new Q&A pairs to append (no preamble, no explanation).`;

  try {
    const client = getClient();
    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a knowledge base curator. Respond only with new Q&A pairs or NOTHING_NEW.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.2,
      max_tokens: 2000,
    });

    const result = completion.choices[0].message.content.trim();

    if (result === 'NOTHING_NEW' || result.toLowerCase().includes('nothing new')) {
      logger.info(`KB enrichment: LLM found nothing new to add (${days} day(s), ${relevantMessages.length} answered messages)`);
      return { added: false, reason: 'No new knowledge found' };
    }

    // Append to KB
    const updated = currentKB ? `${currentKB}\n\n${result}` : result;
    saveKnowledgeBase(updated);

    logger.info(`KB enrichment: added ${result.length} chars from ${days} day(s) of chat history`);
    return {
      added: true,
      newContent: result,
      charsAdded: result.length,
      messagesAnalyzed: messages.length,
      answeredMessages: relevantMessages.length,
    };
  } catch (err) {
    logger.error(`KB enrichment failed: ${err.message}`);
    throw err;
  }
}

module.exports = { enrichKnowledgeBase };
