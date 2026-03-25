# Gita Support Tool

AI-powered WhatsApp & Email support tool that monitors group messages, matches FAQs from a `.docx` / `.txt` knowledge base, detects actionable requests, and provides an admin dashboard for managing inquiries.

## Features

- **WhatsApp Group Monitoring** — Listens to messages in a configured WhatsApp group using whatsapp-web.js
- **Knowledge Base** — Upload `.docx` or `.txt` files to build an FAQ database; AI matches incoming messages against it
- **AI Classification** — Messages are classified as FAQ (auto-reply), Action (remove host / get participants), or Unknown (needs review)
- **Bot Detection Prevention** — Random 45–75 second delays + typing indicators before replying
- **Admin Dashboard** — Real-time web UI to view messages grouped by type, respond manually, manage FAQs, and execute actions
- **Email Webhook** — Exposes `POST /api/email/inbound` for Google Apps Script (or any service) to forward emails for classification

## Quick Start

### 1. Install dependencies

```bash
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
