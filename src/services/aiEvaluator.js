const OpenAI = require('openai');
const { getDb } = require('../config/database');
const logger = require('../utils/logger');

let openai = null;

function getClient() {
  if (!openai) {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openai;
}

const DEFAULT_PROMPT_TEMPLATE = `You are a bot that answers questions in a WhatsApp group where Webex hosts ask questions. You answer using only the facts below.

## Knowledge Base
{{KNOWLEDGE_BASE}}

{{CONTEXT_WINDOW}}

## Your Task
Classify this message into one of three actions, then respond accordingly.

## Classification Rules
1. **"answer"** — The message is a **clear, direct question** asked to the group that you can answer using ONLY the knowledge base above. The person must be explicitly asking for help or information. If the knowledge base does not contain the answer, classify as "ignore".
2. **"remove_host"** — The host is explicitly asking to be removed as a host, wants to step down, no longer wants to host, or is requesting removal from hosting duties.
3. **"ignore"** — **This is your default.** Use this for: casual chat, greetings, thank-you messages, acknowledgments, sharing experiences, venting, statements, announcements, off-topic messages, rhetorical questions, messages directed at a specific person (not the group), or anything you cannot answer strictly from the knowledge base.

**IMPORTANT — err on the side of ignoring:**
- When in doubt, ALWAYS classify as "ignore". It is far better to miss a question than to respond to something that wasn't a question.
- A message must contain a **clear, explicit question or request for help** to be classified as "answer". Statements, observations, or sharing personal experiences are NOT questions even if they mention Webex topics.
- Messages like "I'm having trouble with X" or "My Webex does Y" are statements/observations — only classify as "answer" if the person is clearly asking for help (e.g., "How do I fix X?" or "Can someone help me with Y?").
- If someone is talking TO another person (e.g., replying to someone), ignore it — they are not asking the group.

## Response Rules
- **Always start your reply with "Hari Om, {{SENDER_NAME}}"** — use only the first name if the name is in "First Last" format, otherwise use the full name as-is. This greeting is mandatory for every response (answer and remove_host).
- State facts directly. Do NOT use phrases like "The admin team has shared...", "Per the admin team...", or "We recommend...". Just state the answer.
- Be brief and direct. No filler, no flowery language, no unnecessary preamble.
- **NEVER fabricate, guess, or infer information** that is not explicitly in the knowledge base.
- Do NOT refer to yourself, the admin team, or any internal systems. Just provide the information.
- Use the conversation context to understand what the person is really asking about.
- For **remove_host**: acknowledge their request and let them know the admin team will follow up with them.

{{REPLY_CONTEXT}}
## Message from {{SENDER_NAME}}
"{{MESSAGE}}"

Respond ONLY with valid JSON:
{
  "action": "answer" | "remove_host" | "ignore",
  "confidence": 0.0 to 1.0,
  "response": "Your reply if action is not ignore, null otherwise",
  "reasoning": "Brief explanation of your decision",
  "extracted_info": {
    "host_name": "Full name of the person requesting removal (if remove_host)",
    "host_phone": "Phone number if mentioned in the message (if remove_host, null otherwise)",
    "host_email": "Email address if mentioned in the message (if remove_host, null otherwise)"
  }
}`;

function getPromptTemplate() {
  try {
    const db = getDb();
    const row = db.prepare("SELECT value FROM settings WHERE key = 'llm_prompt'").get();
    return row ? row.value : DEFAULT_PROMPT_TEMPLATE;
  } catch {
    return DEFAULT_PROMPT_TEMPLATE;
  }
}

function buildPrompt(message, senderName, knowledgeBlob, contextWindow, replyContext) {
  let contextSection = '';
  if (contextWindow && contextWindow.length > 0) {
    contextSection = `## Recent Conversation Context\nThese are recent messages in the group. Messages from the same person who asked the question are marked with ★.\n`;
    contextSection += contextWindow
      .map(m => {
        const marker = m.same_sender ? '★ ' : '';
        return `${marker}[${m.sender_name}]: ${m.message}`;
      })
      .join('\n');
  }

  let replySection = '';
  if (replyContext) {
    replySection = `## Replying To\nThis message is a reply to a previous message from ${replyContext.sender_name}:\n"${replyContext.message}"\n\n`;
  }

  const template = getPromptTemplate();
  return template
    .replaceAll('{{KNOWLEDGE_BASE}}', knowledgeBlob || '(No knowledge base configured yet.)')
    .replaceAll('{{CONTEXT_WINDOW}}', contextSection)
    .replaceAll('{{REPLY_CONTEXT}}', replySection)
    .replaceAll('{{SENDER_NAME}}', senderName)
    .replaceAll('{{MESSAGE}}', message);
}

async function evaluateMessage(message, senderName, contextWindow, knowledgeBlob, replyContext) {
  try {
    const prompt = buildPrompt(message, senderName, knowledgeBlob, contextWindow, replyContext);
    const client = getClient();

    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a support assistant. Always respond with valid JSON only.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.1,
      max_tokens: 1000,
    });

    const responseText = completion.choices[0].message.content.trim();

    let jsonStr = responseText;
    const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    const result = JSON.parse(jsonStr);

    const action = result.action || 'ignore';
    logger.info(`Evaluated: action=${action}, confidence=${result.confidence}: ${result.reasoning}`);

    return {
      action,
      shouldRespond: action !== 'ignore',
      confidence: result.confidence || 0,
      response: result.response || null,
      reasoning: result.reasoning || '',
      extracted_info: result.extracted_info || null,
    };
  } catch (err) {
    logger.error(`AI evaluation failed: ${err.message}`);
    return {
      shouldRespond: false,
      confidence: 0,
      response: null,
      reasoning: `Error: ${err.message}`,
    };
  }
}

module.exports = { evaluateMessage, DEFAULT_PROMPT_TEMPLATE };
