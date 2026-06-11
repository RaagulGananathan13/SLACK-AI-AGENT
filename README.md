# Slack AI Agent

A Slack bot built with Node.js, Express, and LangChain that automatically analyzes new community members for product fit using OpenAI's GPT-4. It researches new members, scores their likelihood of being interested in your commercial product, and posts actionable insights to a private Slack channel.

## Features

- **Event-Driven Analysis:** Automatically triggers when a user joins the workspace or a specific channel.
- **Automated Research:** Scrapes the user's company website (via email domain) and GitHub profile to gather background context.
- **AI-Powered Scoring:** Uses OpenAI (`gpt-4`) to generate a "Fit Score" (0-100), key insights, and engagement recommendations based on the gathered data and the user's job title/company.
- **Slack Notifications:** Posts visually color-coded analysis summaries directly to a designated private Slack channel.
- **Persistent Storage:** Stores all analyses and member data in a PostgreSQL database for historical tracking.

## Tech Stack

- **Node.js** & **Express**
- **Slack Bolt API** (`@slack/bolt`, `@slack/web-api`)
- **LangChain** (`@langchain/openai`, `@langchain/core`)
- **OpenAI API** (`gpt-4`)
- **PostgreSQL** (`pg`)
- **Render** (Deployment)

---

## Architecture & Flow

### High-Level Architecture

```mermaid
graph TD
    A[Slack Workspace] -->|Events: team_join, member_joined_channel| B[Slack Bolt App]
    B --> C{Basic Research}
    C -->|Fetch Company Info| D[Company Website]
    C -->|Fetch GitHub Info| E[GitHub API]
    C --> F[LangChain / OpenAI]
    F -->|GPT-4 Analysis| G[Fit Score & Insights]
    G --> H[(PostgreSQL DB)]
    G --> I[Slack Private Channel]
```

### Sequence Flow

```mermaid
sequenceDiagram
    participant S as Slack Workspace
    participant A as Agent (Node.js)
    participant W as Web/GitHub
    participant O as OpenAI (GPT-4)
    participant DB as PostgreSQL
    participant P as Private Slack Channel

    S->>A: User joins workspace/channel
    A->>S: Fetch User Profile & Email
    A->>W: Scrape domain & search GitHub
    W-->>A: Research Data
    A->>O: Prompt with User Info + Research
    O-->>A: JSON Analysis (Fit Score, Insights)
    A->>DB: Save Analysis & Research Data
    A->>P: Post Formatted Message
    A->>DB: Mark as 'sent_to_slack'
```

---

## Prerequisites

- Node.js (v18+ recommended)
- PostgreSQL database
- Slack App credentials (with Socket Mode enabled)
- OpenAI API Key

## Installation & Setup

1. **Clone the repository:**
   ```bash
   git clone <repository-url>
   cd SLACK-AI-AGENT
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Environment Configuration:**
   Copy `.env.sample` to `.env` and fill in your credentials.

   ```env
   # Slack Configuration
   SLACK_BOT_TOKEN=xoxb-your-bot-token
   SLACK_APP_TOKEN=xapp-your-app-token
   SLACK_SIGNING_SECRET=your-signing-secret
   SLACK_PRIVATE_CHANNEL_ID=C1234567890

   # OpenAI Configuration
   OPENAI_API_KEY=sk-your-openai-key

   # Database Configuration
   DATABASE_URL=postgres://user:password@localhost:5432/slack_db

   # Company Context (Used for AI Prompt)
   COMPANY_NAME="Your Company Name"
   COMPANY_PRODUCT="Your Commercial Product"
   
   # Server
   NODE_ENV=development
   PORT=3000
   ```

## Running the Application

**Development Mode (with auto-reload):**
```bash
npm run dev
```

**Production Mode:**
```bash
npm start
```

### Testing the Agent Locally
In development mode, you can trigger a mock analysis via the local Express endpoint without needing a real Slack event:

```bash
curl -X POST http://localhost:3000/test/analyze-member \
  -H "Content-Type: application/json" \
  -d '{
    "memberInfo": {
      "id": "U12345",
      "name": "Jane Doe",
      "email": "jane@example.com",
      "title": "Senior Engineer"
    }
  }'
```

---

## Database Schema

The agent automatically initializes a `member_analyses` table on startup.

| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | SERIAL | Primary Key |
| `member_id` | VARCHAR | Slack User ID |
| `member_name` | VARCHAR | User's real name |
| `member_email` | VARCHAR | User's email address |
| `fit_score` | INTEGER | AI generated product fit score (0-100) |
| `insights` | JSONB | Array of AI-generated insights |
| `recommendations` | JSONB | Array of engagement recommendations |
| `research_data` | JSONB | Raw scraped data from web/GitHub |
| `sent_to_slack` | BOOLEAN | Delivery status |

---

## Deployment (Render)

This project includes a `render.yaml` file for easy deployment to [Render](https://render.com).

It provisions:
1. A managed **PostgreSQL database** (`slack-agent-db`, basic-256mb plan).
2. A **Web Service** (`slack-ai-agent`, starter plan) running the Node.js app.

**To Deploy:**
1. Connect your repository to Render via Blueprint.
2. Render will automatically detect the `render.yaml`.
3. Provide the required environment variables (`SLACK_BOT_TOKEN`, `OPENAI_API_KEY`, etc.) in the Render dashboard securely.
