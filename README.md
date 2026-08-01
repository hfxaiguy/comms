# comms

A CLI tool for managing professional relationships and networking. Track contacts, send templated emails, process business cards, and import data from Google Sheets, CSV, and JSON — all from the terminal.

## Features

- **Profile management** — create, search, edit, and view contact profiles with rich attributes (email, phone, social, company, profession, notes, relationships)
- **Email** — send templated emails individually or in blasts, with IMAP sent-folder sync
- **Business card processing** — extract contact info from card images using AI (Hugging Face / OpenAI vision)
- **Import** — pull contacts from Google Sheets, CSV, or JSON files
- **TUI** — interactive terminal UI (built with Ink/React) for browsing profiles, sending emails, and chatting with an AI assistant
- **Relationship tracking** — link people together and track connection levels, promises, and proposals
- **Tab completion** — fast shell completion for names, groups, and templates

## Prerequisites

- Node.js (ES module support)
- A Google service account JSON file (for Sheets integration)
- SMTP credentials (for email sending)
- Hugging Face API key (optional, for business card OCR)

## Installation

```bash
git clone <repo-url> && cd communications
npm install
```

To use `comms` as a global command:

```bash
npm link
```

## Configuration

Create these files in the project root (all gitignored):

**`sheets.config.json`** — Google Sheets to import from:

```json
{
  "spreadsheets": [
    { "id": "<spreadsheet-id>" }
  ]
}
```

**`email.config.json`** — SMTP/IMAP accounts:

```json
{
  "groups": {
    "Group Name": {
      "from": "Your Name <you@example.com>",
      "smtp": { "host": "smtp.example.com", "port": 465, "auth": { "user": "you@example.com", "pass": "password" } },
      "imap": { "host": "imap.example.com", "port": 993, "auth": { "user": "you@example.com", "pass": "password" } }
    }
  }
}
```

**`service-account.json`** — Google Cloud service account credentials.

## Usage

```bash
# Open the interactive TUI
comms

# List all profiles
comms profiles

# Search
comms search "john"

# View or edit a profile
comms edit "John Doe"
comms edit "John Doe" --set email=john@example.com
comms edit "John Doe" --add phone=555-1234
comms edit "John Doe" --delete 42

# Add a person interactively
comms add-person

# Import from various sources
comms import-csv contacts.csv --group "Conference 2025"
comms import-json contacts.json --group "Leads"
comms migrate

# Email
comms send-email "John Doe" welcome
comms send-blast "Conference 2025" follow-up
comms test-email you@example.com

# Log communications
comms log-whatsapp "John" "Sent project update"
comms log-email "John" "Re: Project proposal"

# Business cards
comms process-cards
comms process-cards --reprocess

# Maintenance
comms bust-cache
comms add-sheet <spreadsheet-url-or-id>
comms help
```

## Email Templates

Place `.txt` files in `email-templates/`. Each file is a template — the filename (without extension) is the template name. Use `{{field}}` placeholders for personalization.

## Running Tests

```bash
npm test
```

## License

MIT
