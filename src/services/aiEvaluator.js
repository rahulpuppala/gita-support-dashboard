const OpenAI = require('openai');
const logger = require('../utils/logger');

let openai = null;

function getClient() {
  if (!openai) {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openai;
}

function buildPrompt(message, senderName, knowledgeBlob, contextWindow) {
  let contextSection = '';
  if (contextWindow && contextWindow.length > 0) {
    contextSection = `\n\n## Recent Conversation Context\nThese are recent messages in the group. Messages from the same person who asked the question are marked with ★.\n`;
    contextSection += contextWindow
      .map(m => {
        const marker = m.same_sender ? '★ ' : '';
        return `${marker}[${m.sender_name}]: ${m.message}`;
      })
      .join('\n');
  }

  return `You are responding on behalf of the admin team in a WhatsApp group where Webex hosts ask questions and the admin team provides support. When a host asks a question, you reply as a member of the admin team — warm, concise, and natural.

## Knowledge Base
${knowledgeBlob || '(No knowledge base configured yet.)'}${contextSection}

## Your Task
Classify this message into one of three actions, then respond accordingly.

## Classification Rules
1. **"answer"** — The message is a question or request you can address using the knowledge above. Be generous — if the knowledge covers it, answer it.
2. **"remove_host"** — The host is asking to be removed as a host, wants to step down, no longer wants to host, or is requesting removal from hosting duties.
3. **"ignore"** — Casual chat, greetings, announcements, off-topic, or something you can't answer from the knowledge base.

## Response Rules
- **Always start your reply with "Hari Om"** — this is mandatory for every response (answer and remove_host)
- Sound like a real person in a WhatsApp group — friendly, direct, conversational
- Do NOT sound robotic. Do NOT mention "knowledge base", "FAQs", or internal systems.
- Use the conversation context to understand what the person is really asking about
- If referencing info origin, cite naturally (e.g., "As Goutham mentioned..." or "Per the Host Guide...")
- For **remove_host**: respond warmly that their request to be removed as a host has been noted and the admin team will follow up.

## Message from ${senderName}
"${message}"

Respond ONLY with valid JSON:
{
  "action": "answer" | "remove_host" | "ignore",
  "confidence": 0.0 to 1.0,
  "response": "Your reply if action is not ignore, null otherwise",
  "reasoning": "Brief explanation of your decision"
}`;
}

async function evaluateMessage(message, senderName, contextWindow, knowledgeBlob) {
  try {
    const prompt = buildPrompt(message, senderName, knowledgeBlob, contextWindow);
    const client = getClient();

    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a support assistant. Always respond with valid JSON only.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
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

module.exports = { evaluateMessage };
