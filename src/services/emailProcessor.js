const OpenAI = require('openai');
const { getDb } = require('../config/database');
const Email = require('../models/Email');
const Action = require('../models/Action');
const { createDraftReply, labelProcessed, labelFailed, labelActionRequired } = require('./emailService');
const logger = require('../utils/logger');

let openai = null;

function getClient() {
  if (!openai) {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openai;
}

const DEFAULT_EMAIL_PROMPT = `You are a bot that processes emails sent to a support inbox for Webex event hosts. You answer using only the facts below.

## Knowledge Base
{{KNOWLEDGE_BASE}}

{{THREAD_CONTEXT}}

## Your Task
Classify this email into one of three actions, then respond accordingly.

## Classification Rules
1. **"answer"** — The email is a question or request you can address using ONLY the knowledge base above. If the knowledge base does not contain the answer, classify as "ignore" instead.
2. **"remove_host"** — The sender is asking to be removed as a host, wants to step down, no longer wants to host, or is requesting removal from hosting duties.
3. **"ignore"** — Auto-replies, newsletters, FYI emails, or anything you cannot answer strictly from the knowledge base.

## Response Rules
- **Always start your reply with "Hari Om, {{SENDER_NAME}}"** — use only the first name if the name is in "First Last" format, otherwise use the full name as-is. This greeting is mandatory for every response (answer and remove_host).
- State facts directly. Do NOT use phrases like "The admin team has shared...", "Per the admin team...", or "We recommend...". Just state the answer.
- Be brief and direct. No filler, no flowery language, no unnecessary preamble.
- **NEVER fabricate, guess, or infer information** that is not explicitly in the knowledge base.
- Do NOT refer to yourself, the admin team, or any internal systems. Just provide the information.
- For **remove_host**: acknowledge their request and let them know the admin team will follow up with them.
- Format the reply as a proper email response (not JSON). Use line breaks for readability.

## Email from {{SENDER_NAME}} <{{SENDER_EMAIL}}>
Subject: {{SUBJECT}}

{{EMAIL_BODY}}

Respond ONLY with valid JSON:
{
  "action": "answer" | "remove_host" | "ignore",
  "confidence": 0.0 to 1.0,
  "response": "Your email reply if action is not ignore, null otherwise",
  "reasoning": "Brief explanation of your decision",
  "extracted_info": {
    "host_name": "Full name of the person requesting removal (if remove_host)",
    "host_email": "Email address of the person requesting removal (if remove_host)"
  }
}`;

function getEmailPromptTemplate() {
  try {
    const db = getDb();
    const row = db.prepare("SELECT value FROM settings WHERE key = 'email_llm_prompt'").get();
    return row ? row.value : DEFAULT_EMAIL_PROMPT;
  } catch {
    return DEFAULT_EMAIL_PROMPT;
  }
}

function buildEmailPrompt(email, knowledgeBlob, threadContext) {
  let threadSection = '';
  if (threadContext && threadContext.length > 0) {
    threadSection = `## Previous Emails in This Thread\n`;
    threadSection += threadContext
      .map(e => `From: ${e.from_name} <${e.from_address}>\nSubject: ${e.subject}\n${e.body_snippet || e.body_text?.substring(0, 500) || ''}`)
      .join('\n---\n');
  }

  const template = getEmailPromptTemplate();
  return template
    .replaceAll('{{KNOWLEDGE_BASE}}', knowledgeBlob || '(No knowledge base configured yet.)')
    .replaceAll('{{THREAD_CONTEXT}}', threadSection)
    .replaceAll('{{SENDER_NAME}}', email.from_name || 'Unknown')
    .replaceAll('{{SENDER_EMAIL}}', email.from_address || '')
    .replaceAll('{{SUBJECT}}', email.subject || '(no subject)')
    .replaceAll('{{EMAIL_BODY}}', email.body_text || email.body_snippet || '');
}

async function processEmail(emailRecord) {
  try {
    // --- DEDUP: check if another email in this thread was already classified ---
    const existingInThread = Email.findThreadClassified(emailRecord.gmail_thread_id, emailRecord.id);
    if (existingInThread) {
      Email.saveClassification(emailRecord.id, {
        classification: 'duplicate',
        confidence: 1,
        response: null,
        reasoning: `Duplicate — thread already classified as "${existingInThread.classification}" (email #${existingInThread.id}).`,
        status: 'ignored',
        duplicate_of: existingInThread.id,
      });
      await labelProcessed(emailRecord.gmail_msg_id);
      logger.info(`Email ${emailRecord.id} marked as duplicate of ${existingInThread.id}`);
      return { action: 'duplicate', duplicate_of: existingInThread.id };
    }

    // --- BUILD CONTEXT ---
    const db = getDb();
    const kbRow = db.prepare("SELECT value FROM settings WHERE key = 'knowledge_base'").get();
    const knowledgeBlob = kbRow ? kbRow.value : '';

    const threadEmails = Email.findByThreadId(emailRecord.gmail_thread_id)
      .filter(e => e.id !== emailRecord.id);

    const prompt = buildEmailPrompt(emailRecord, knowledgeBlob, threadEmails);

    // --- CALL LLM ---
    const client = getClient();
    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a support assistant. Always respond with valid JSON only.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 1500,
    });

    const responseText = completion.choices[0].message.content.trim();
    let jsonStr = responseText;
    const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) jsonStr = jsonMatch[1].trim();

    const result = JSON.parse(jsonStr);
    const action = result.action || 'ignore';

    logger.info(`Email ${emailRecord.id} classified: action=${action}, confidence=${result.confidence}`);

    // --- IGNORE ---
    if (action === 'ignore') {
      Email.saveClassification(emailRecord.id, {
        classification: 'ignore',
        confidence: result.confidence || 0,
        response: null,
        reasoning: result.reasoning || '',
        status: 'ignored',
      });
      await labelProcessed(emailRecord.gmail_msg_id);
      return { action: 'ignore', reasoning: result.reasoning };
    }

    // --- REMOVE_HOST ---
    if (action === 'remove_host') {
      Email.saveClassification(emailRecord.id, {
        classification: 'remove_host',
        confidence: result.confidence || 0,
        response: result.response,
        reasoning: result.reasoning || '',
        status: 'classified',
      });

      const extracted = result.extracted_info || {};
      Action.create({
        chat_id: null,
        action_type: 'remove_host',
        sender_id: emailRecord.from_address,
        sender_name: extracted.host_name || emailRecord.from_name || emailRecord.from_address,
        group_id: 'email',
        details: {
          email_id: emailRecord.id,
          subject: emailRecord.subject,
          message: emailRecord.body_snippet,
          reasoning: result.reasoning,
          source: 'email',
          host_name: extracted.host_name || emailRecord.from_name || null,
          host_email: extracted.host_email || emailRecord.from_address || null,
        },
      });

      await labelActionRequired(emailRecord.gmail_msg_id);

      // Auto-create draft reply
      if (result.response) {
        try {
          await createDraftReply(emailRecord.id, result.response);
        } catch (err) {
          logger.error(`Failed to create draft for email ${emailRecord.id}: ${err.message}`);
        }
      }

      return { action: 'remove_host', response: result.response, reasoning: result.reasoning };
    }

    // --- ANSWER ---
    Email.saveClassification(emailRecord.id, {
      classification: 'answer',
      confidence: result.confidence || 0,
      response: result.response,
      reasoning: result.reasoning || '',
      status: 'classified',
    });

    // Auto-create draft reply
    if (result.response) {
      try {
        await createDraftReply(emailRecord.id, result.response);
      } catch (err) {
        logger.error(`Failed to create draft for email ${emailRecord.id}: ${err.message}`);
      }
    }

    await labelProcessed(emailRecord.gmail_msg_id);
    return { action: 'answer', response: result.response, reasoning: result.reasoning };

  } catch (err) {
    logger.error(`Email processing failed for ${emailRecord.id}: ${err.message}`);
    Email.saveClassification(emailRecord.id, {
      classification: 'error',
      confidence: 0,
      response: null,
      reasoning: `Processing error: ${err.message}`,
      status: 'error',
    });
    try { await labelFailed(emailRecord.gmail_msg_id); } catch (_) {}
    return { action: 'error', error: err.message };
  }
}

// ─── Backfill Controller ────────────────────────────────
let backfillState = { running: false, total: 0, processed: 0, current: null, stopRequested: false };

function getBackfillStatus() {
  return { ...backfillState };
}

function stopBackfill() {
  if (backfillState.running) {
    backfillState.stopRequested = true;
    logger.info('Backfill stop requested');
  }
}

async function runBackfill(emails, delayMs = 3000, socketIO = null) {
  if (backfillState.running) throw new Error('Backfill already in progress');

  backfillState = { running: true, total: emails.length, processed: 0, current: null, stopRequested: false };
  if (socketIO) socketIO.emit('email_backfill_started', { total: emails.length });

  for (const email of emails) {
    if (backfillState.stopRequested) {
      logger.info(`Backfill stopped at ${backfillState.processed}/${backfillState.total}`);
      break;
    }

    backfillState.current = { id: email.id, subject: email.subject, from: email.from_name };
    if (socketIO) socketIO.emit('email_backfill_progress', { ...backfillState });

    try {
      await processEmail(email);
    } catch (err) {
      logger.error(`Backfill error on email ${email.id}: ${err.message}`);
    }

    backfillState.processed++;
    if (socketIO) socketIO.emit('email_backfill_progress', { ...backfillState });

    // Rate limit delay
    if (backfillState.processed < emails.length && !backfillState.stopRequested) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  backfillState.running = false;
  backfillState.current = null;
  if (socketIO) socketIO.emit('email_backfill_complete', { processed: backfillState.processed, total: backfillState.total });
  logger.info(`Backfill complete: ${backfillState.processed}/${backfillState.total}`);
}

module.exports = {
  processEmail,
  runBackfill,
  getBackfillStatus,
  stopBackfill,
  DEFAULT_EMAIL_PROMPT,
};
