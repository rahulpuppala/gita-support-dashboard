const OpenAI = require('openai');
const { getKnowledgeContext, getReferenceContext } = require('./knowledgeBase');
const logger = require('../utils/logger');

let openai = null;

function getClient() {
  if (!openai) {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openai;
}

function buildClassificationPrompt(message, faqContext, refContext) {
  const refSection = refContext
    ? `\n\n## Reference Context\nUse this additional context to help answer questions that may not directly match an FAQ:\n${refContext}`
    : '';

  return `You are a friendly and helpful support assistant in a WhatsApp group. When someone asks a question, you reply directly to them as if you are having a conversation — warm, concise, and natural. You are NOT a classification bot to the user; you are their helpful support person.

## Knowledge Base (FAQs)
${faqContext}${refSection}

## Available Actions
- **remove_host**: The user wants to be removed as a group host/admin
- **get_participants**: The user wants to get participant/member details of the group

## Your Task
Classify the message below. If it matches an FAQ, write a direct reply to the person as if you are responding in the group chat. For actions and unknown messages, do NOT write a reply — those will be silently tracked for admin review.

## Classification Rules
1. **"faq"** — The message matches or closely relates to a question in the knowledge base. Write a helpful reply directly addressing the person's question. This is the ONLY classification that gets a response sent back to the user.
2. **"action"** — The message is requesting one of the available actions listed above. Do NOT generate a reply — set response to null. The action will be tracked and handled by an admin.
3. **"unknown"** — The message doesn't match any FAQ and isn't requesting a known action. Do NOT generate a reply — set response to null. It will be flagged for human review.

## Important Notes
- Be generous with FAQ matching — if the message is asking something similar to a FAQ, classify it as "faq"
- Look for intent, not exact wording
- For actions, look for phrases like "remove me as host", "make me not admin", "step down as host", "participant list", "member details", "who is in the group", etc.
- For remove_host actions: extract any email address mentioned in the message and include it in "extracted_email". If no email is found, set it to null.
- Casual greetings, off-topic messages, and unclear requests should be "unknown"
- For FAQ responses: sound like a real person replying in a WhatsApp group — friendly, direct, and conversational. Do NOT sound robotic or overly formal.
- Do NOT mention the knowledge base, FAQs, classification, or any internal system details in your response.

## Message from the user
"${message}"

Respond ONLY with valid JSON in this exact format:
{
  "classification": "faq" | "action" | "unknown",
  "confidence": 0.0 to 1.0,
  "response": "Your direct reply to the person for FAQ only, null for action/unknown",
  "action_type": "remove_host" | "get_participants" | null,
  "extracted_email": "email found in message for remove_host, or null",
  "reasoning": "Brief internal explanation of why you classified it this way"
}`;
}

async function classifyMessage(message) {
  try {
    const faqContext = getKnowledgeContext();
    const refContext = getReferenceContext();
    const prompt = buildClassificationPrompt(message, faqContext, refContext);
    const client = getClient();

    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a message classification assistant. Always respond with valid JSON only.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 1000,
    });

    const responseText = completion.choices[0].message.content.trim();

    // Extract JSON from response (handle markdown code blocks)
    let jsonStr = responseText;
    const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    const result = JSON.parse(jsonStr);

    logger.info(`Message classified as "${result.classification}" with confidence ${result.confidence}: ${result.reasoning}`);

    return {
      classification: result.classification || 'unknown',
      confidence: result.confidence || 0,
      response: result.response || null,
      action_type: result.action_type || null,
      extracted_email: result.extracted_email || null,
      reasoning: result.reasoning || '',
    };
  } catch (err) {
    logger.error(`AI classification failed: ${err.message}`);

    // Fallback: mark as unknown so it appears on dashboard
    return {
      classification: 'unknown',
      confidence: 0,
      response: null,
      action_type: null,
      reasoning: `Classification error: ${err.message}`,
    };
  }
}

module.exports = { classifyMessage };
