# Gita Support - Self-Maintaining WhatsApp Bot

AI-powered WhatsApp support bot that learns from admin conversations and automatically maintains its knowledge base.

## What's New in v2.0

This refactored version transforms the bot into a **self-maintaining system** that:
- ✅ **Learns from admin conversations** - Automatically extracts Q&A pairs when admins answer questions
- ✅ **3 simple outcomes** - Answer, Remove Host, or Ignore (no more manual review of every message)
- ✅ **Data provenance** - Every answer cites its source (admin name, document, or website)
- ✅ **Multi-source knowledge base** - Syncs from files, websites, and Google Drive
- ✅ **Conflict detection** - Flags when new info contradicts existing FAQs

## Core Features

### 1. Automatic Learning from Admin Conversations
When an admin replies to a host's question in the WhatsApp group, the bot:
1. Analyzes the conversation context (last 15-20 messages)
2. Extracts a clean Q&A pair using LLM
3. Stores it as a "Suggested FAQ" for admin approval
4. Makes it available to the bot immediately (even before approval)

**Example:**
```
Host: "help with OBS recording"
Admin (Goutham): "Set the OBS canvas resolution equal to your display resolution to capture the entire screen"
→ Bot extracts: Q: "How do I set up OBS to record correctly?" A: "Set the OBS canvas..."
```

### 2. Three-Outcome Classification
Every message is classified as:
- **answer** - Bot has a good KB match → replies immediately (prod mode) or logs for review (test mode)
- **remove_host** - User wants to be removed → bot replies "Your request has been noted" + queues for admin
- **ignore** - Everything else → silently stored, no action

### 3. Knowledge Base Sources
The bot pulls knowledge from:
- **Admin conversations** (auto-extracted Q&A pairs)
- **Word documents** (.docx/.txt files in `knowledge-base/` folder)
- **Websites** (configured URLs scraped daily)
- **Google Drive** (syncs from a shared folder)
- **Manual entries** (via dashboard)

### 4. Data Provenance
Every FAQ includes source attribution:
```
FAQ 42 [source: Goutham, March 15]:
Q: Where can hosts find participant info?
A: Log in to the portal, click Meetings at the top...
```

The bot naturally cites sources in responses:
> "As Goutham mentioned, participant info is under the Meetings menu at the top..."

## Installation

### Prerequisites
- Node.js 18+ (for OpenAI SDK and better-sqlite3)
- OpenAI API key

### Setup
```bash
# Clone and install
git clone <repo-url>
cd gita-support
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env with your settings (at minimum OPENAI_API_KEY)
```

### 3. Run database migrations & seed

```bash
npm run migrate
npm run seed
```

This creates a default admin account: **admin / admin123**

### 4. Start the application

```bash
npm start        # production
npm run dev      # development with hot-reload
```

### 5. Scan QR code

On first run, a QR code will appear in the terminal. Scan it with WhatsApp to authenticate.

### 6. Open the dashboard

Visit [http://localhost:3000](http://localhost:3000) and log in with the default credentials.

## Configuration

| Variable | Description | Default |
|---|---|---|
| `OPENAI_API_KEY` | OpenAI API key for message classification | *required* |
| `MONITORED_GROUP_ID` | WhatsApp group ID to monitor | *auto-lists groups* |
| `PORT` | Dashboard server port | `3000` |
| `MIN_RESPONSE_DELAY` | Minimum reply delay (ms) | `45000` |
| `MAX_RESPONSE_DELAY` | Maximum reply delay (ms) | `75000` |
| `JWT_SECRET` | Secret for dashboard auth tokens | *change this* |

## Knowledge Base

Place `.docx` or `.txt` files in the `knowledge-base/` directory, or upload them through the dashboard. The system extracts Q&A pairs automatically and uses them for FAQ matching.

Supported `.txt` format (numbered FAQ):

```
1) What is this group for?

This group supports hosts for the event...

2) How do I join?

You can join by...
```

## Email Integration

Email is handled via a webhook endpoint. Set up a Google Apps Script to forward new emails:

```
POST /api/email/inbound
Content-Type: application/json

{
  "from": "sender@example.com",
  "fromName": "Sender Name",
  "subject": "Email subject",
  "body": "Email body text"
}
```

The endpoint classifies the email the same way WhatsApp messages are classified.

## Actions

Currently supported actions:
- **Remove Host** — User requests to be removed as group admin
- **Get Participant Details** — User requests group member information

Actions are logged and displayed in the dashboard for admin review and execution.

## Project Structure

```
src/
├── app.js                    # Main entry point
├── config/database.js        # SQLite configuration
├── database/                 # Migrations and seeds
├── middleware/                # Auth and error handling
├── models/                   # Data models (Chat, Action, FAQ, User)
├── routes/api/               # REST API endpoints
├── services/
│   ├── whatsappService.js    # WhatsApp monitoring
│   ├── knowledgeBase.js      # DOCX/TXT processing
│   ├── aiEvaluator.js        # AI classification
│   ├── actionHandler.js      # Action execution
│   ├── responseService.js    # Response delivery with delays
│   └── emailWebhook.js       # Email inbound webhook (in routes/api/)
└── utils/                    # Logging, delays, text processing
public/                       # Dashboard frontend
knowledge-base/               # DOCX/TXT files directory
```
