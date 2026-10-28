# Slack AI Agent

![CI](https://github.com/RaagulGananathan13/SLACK-AI-AGENT/actions/workflows/ci.yml/badge.svg)

A Slack bot that researches every new member of your community, scores them as a sales lead with an LLM, and gives your team a place to act on it: review buttons, a drafted welcome DM, a dashboard in the App Home, a weekly digest, and an assistant you can ask about leads in plain English.

Everything runs on free tiers: Groq, Gemini, OpenRouter or a local Ollama model for the LLM, public GitHub and Wikidata data for research, and a Postgres you can start with Docker.

## What it does

When someone joins the workspace (or a channel you watch), the agent:

1. **Queues them in Postgres**, so a burst of joins or a restart doesn't lose anyone, and duplicate events collapse into one analysis.
2. **Researches them in parallel**
   - **Company website**: name and description from the page metadata. The domain comes from the member's email, so requests to private and internal addresses are blocked.
   - **Wikidata**: company size, industry, founding year and HQ, matched on the official website property instead of a fuzzy name search.
   - **GitHub**: matched by email first, then by full name plus employer. Ambiguous matches are dropped, not guessed.
3. **Scores them 0-100** against your ideal customer profile, with a confidence level, a segment, a summary, insights, next steps and a personalised welcome message.
4. **Posts the analysis** to your private leads channel with buttons: *Good fit* / *Not a fit* (stored as feedback), *Send welcome DM* (opens the draft in an editable modal) and *Re-analyze*.

On top of that:

- **Ask the bot.** Mention it in the leads channel or DM it: *"who are the best fintech leads this month?"*, *"what do we know about @jane?"*. It answers through a tool-calling loop over read-only database queries.
- **App Home dashboard**: 30 day stats, tier breakdown, this week's top leads, how many hot leads the team confirmed, queue health.
- **`/agent` command**: `analyze @someone`, `leads [days]`, `stats [days]`, `digest`, `forget @someone`.
- **Weekly digest**: stats, the top five leads and a short AI summary of the week, on the day, hour and timezone you choose.
- **Privacy controls**: lead data is only visible to members of the leads channel, `forget` deletes a member's data and posts and stops future analysis, and there's an optional retention window.
- **Eval harness**: `npm run eval` scores ten fixed personas (one of them a prompt injection attempt) so model and prompt changes can be compared with numbers.

## Free LLM providers

| Provider | Default model | Key | |
| --- | --- | --- | --- |
| Groq | `llama-3.3-70b-versatile` | `GROQ_API_KEY` | free tier, very fast |
| Google Gemini | `gemini-3.8-flash` | `GEMINI_API_KEY` | free tier from AI Studio |
| OpenRouter | `openrouter/free` | `OPENROUTER_API_KEY` | routes to a free model that's available |
| Ollama | `llama3.1` | none | runs on your own machine |
| OpenAI | `gpt-6-luna` | `OPENAI_API_KEY` | paid |

Set `LLM_PROVIDER`, or leave it empty and the agent uses whichever key it finds. `LLM_MODEL` overrides the model, and `LLM_BASE_URL` + `LLM_API_KEY` point it at any other OpenAI compatible server (LM Studio, vLLM, Together...). The assistant needs a model with tool calling; all the defaults have it.

## Architecture

```mermaid
graph TD
    S[Slack workspace] -->|team_join, member_joined_channel| E[Bolt app, socket mode]
    E --> Q[(analysis_jobs)]
    Q --> W[Job worker]
    W --> R{Research in parallel}
    R --> C[Company site metadata]
    R --> D[Wikidata]
    R --> G[GitHub API]
    W --> L[LLM: Groq / Gemini / OpenRouter / Ollama / OpenAI]
    L -->|validated JSON| DB[(member_analyses)]
    DB --> P[Private leads channel]
    P -->|buttons, modals| E
    U[Team member] -->|mention, DM, /agent, App Home| E
    E --> A[Lead assistant]
    A -->|read-only tools| DB
```

```mermaid
sequenceDiagram
    participant S as Slack
    participant A as Agent
    participant Q as Postgres queue
    participant R as Web / GitHub / Wikidata
    participant L as LLM
    participant P as Leads channel

    S->>A: member joins
    A->>Q: enqueue (one live job per member)
    Q-->>A: worker claims job (FOR UPDATE SKIP LOCKED)
    A->>S: users.info
    A->>R: research in parallel (cached 24h)
    A->>L: profile + research, marked as untrusted
    L-->>A: JSON, validated with zod (one repair round if needed)
    A->>Q: save analysis
    A->>P: post with review buttons
    P->>A: Good fit / Welcome DM / Re-analyze
```

## How the AI parts work

**Structured output that works on free models.** Plenty of free models don't support JSON mode reliably, so the analyzer asks for JSON, takes the first object in the reply that parses (code fences, chatter and `<think>` blocks are skipped) and validates it with zod. If validation fails, the exact error goes back to the model once so it can fix its answer. The score and lists are required; optional fields fall back to defaults instead of costing another call.

**Prompt injection.** Everything that comes from the member or the web is wrapped in `<member>` / `<research>` tags, stripped of angle brackets so it can't close those tags, length capped, and the system prompt says to treat it as data. The eval includes a case where both the title and the scraped site try to force a score of 100. Model output is escaped before it reaches Slack, so a title like `<!channel>` can't ping anyone.

**The assistant** is a small tool-calling loop (at most five steps) over four read-only tools: `get_top_leads`, `search_members`, `get_member` and `get_stats`. Bad arguments and unknown tools go back to the model as errors so it can recover. The tools hand over email domains, never full addresses, and the assistant only answers in the leads channel or in DMs.

**Data quality.** A wrong GitHub match is worse than none, because the model will reason confidently about a stranger. A profile is only used when it was found by email, or when the name matches exactly *and* the profile points at the member's employer (or the name is unique on GitHub).

## Quick start

1. **Create the Slack app** from [`manifest.yml`](manifest.yml): api.slack.com/apps → *Create New App* → *From a manifest*. That sets up the scopes, events, slash command and socket mode.
2. Install it to your workspace. Copy the **bot token** (`xoxb-...`, under OAuth & Permissions) and create an **app-level token** with `connections:write` (`xapp-...`, under Basic Information).
3. Create a private channel for leads, invite the bot to it and copy the channel id.
4. Get a free LLM key, for example from [console.groq.com/keys](https://console.groq.com/keys).
5. Configure and run:

```bash
cp .env.sample .env   # tokens, channel id, LLM key, what your company sells
npm install
npm run dev
```

You need a Postgres for `DATABASE_URL`. The quickest way is Docker, which starts the agent and a database together:

```bash
docker compose up --build
```

For a fully local setup without any API key, add the Ollama profile:

```bash
docker compose --profile ollama up --build
docker compose exec ollama ollama pull llama3.1
# then set LLM_PROVIDER=ollama and OLLAMA_BASE_URL=http://ollama:11434/v1 in .env
```

## Configuration

| Variable | Default | |
| --- | --- | --- |
| `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN` | | required |
| `SLACK_PRIVATE_CHANNEL_ID` | | required. Analyses go here, and only its members can see lead data |
| `DATABASE_URL` | | required |
| `DATABASE_SSL` | `true` | `false` for a local Postgres |
| `LLM_PROVIDER`, `LLM_MODEL` | picked from the key | see the provider table |
| `COMPANY_NAME`, `COMPANY_PRODUCT`, `COMPANY_ICP` | | what you sell and to whom; the score depends on it |
| `WATCH_CHANNEL_IDS` | any public channel | only analyze people who join these channels |
| `REANALYZE_AFTER_DAYS` | `30` | skip members analyzed more recently than this |
| `ANALYSIS_CONCURRENCY` | `2` | analyses running at the same time |
| `ANALYSIS_MAX_ATTEMPTS` | `3` | retries (after 30s, 2m, 8m) before a failure notice is posted |
| `GITHUB_TOKEN` | | optional, raises the GitHub search limit from 10 to 30 a minute. No scopes needed |
| `DIGEST_ENABLED`, `DIGEST_DAY`, `DIGEST_HOUR`, `DIGEST_TIMEZONE` | `true`, `mon`, `9`, `UTC` | weekly digest schedule |
| `DATA_RETENTION_DAYS` | `0` | delete analyses older than this; `0` keeps them |
| `SLACK_COMMAND` | `/agent` | if you rename the command in the manifest |
| `LOG_LEVEL`, `LOG_FORMAT` | `info`, text | `LOG_FORMAT=json` for structured logs |

The configuration is checked on startup, and the agent tells you exactly what's missing or invalid instead of failing later.

## Using it

| | |
| --- | --- |
| `/agent analyze @someone` | research and score a member right now |
| `/agent leads [days]` | top leads, last 7 days by default |
| `/agent stats [days]` | totals, tiers, team feedback, top segments |
| `/agent digest` | post the weekly digest now |
| `/agent forget @someone` | delete their analyses and posts, and never analyze them again |
| `@AI Agent who should we talk to first?` | ask in the leads channel or in a DM |

## Evaluating models

```bash
npm run eval                                   # the provider your .env picks
npm run eval -- --provider gemini              # compare with another one
npm run eval -- --model llama-3.1-8b-instant --out small-model.json
```

Each persona has an expected score band, and some have an expected confidence. The run prints a table, the pass rate and how far the misses landed outside their band. It exits non-zero below 80% (`--min-pass` changes that), so it can gate prompt changes in CI.

## Reliability

- Joins go into a Postgres queue instead of being processed inside the event handler. A partial unique index allows one live job per member, so `team_join` plus a couple of channel joins turns into a single analysis.
- Workers claim jobs with `FOR UPDATE SKIP LOCKED`, so more than one instance can run.
- Failed jobs retry with backoff, jobs left running by a crashed process are picked up again, and an analysis that was saved but never posted gets posted on the retry instead of being paid for twice.
- Shutdown waits for running jobs. Scheduled tasks are claimed in the database, so the digest goes out once even with several instances.

## Development

```bash
npm test
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npm test
```

Without `TEST_DATABASE_URL` the database suites are skipped. With it they run against a real Postgres, including an end-to-end flow that drives the real Bolt app against a fake Slack API: a member joins, gets analyzed and posted, someone marks them a good fit and sends the welcome DM, the assistant is asked about them, and finally `forget` cleans everything up. CI runs all of it on Node 22 and 24 with Postgres 17, and builds the Docker image.

In development mode you can run the pipeline without a Slack event:

```bash
curl -X POST http://localhost:3000/test/analyze-member \
  -H "Content-Type: application/json" \
  -d '{ "post": false, "memberInfo": { "name": "Jane Doe", "email": "jane@stripe.com", "title": "VP Engineering" } }'
```

### Project layout

```
index.js            entry point: config check, signals
src/
  agent.js          wires slack, express, the queue and the scheduler together
  config.js         env parsing, provider presets, validation
  db.js             schema and queries
  queue.js          job worker with concurrency, retries and backoff
  scheduler.js      weekly digest and daily cleanup
  ai/               llm client, analyzer, json repair, assistant and its tools, digest summary
  research/         company site, wikidata, github, email classification, ssrf-safe http client
  slack/            block kit, buttons and modals, /agent, app home, mentions, access control
eval/               personas and the eval runner
test/               node:test suites and a fake slack api
```

## Deployment

`render.yaml` sets up a Postgres database and a web service on [Render](https://render.com). Connect the repo as a Blueprint and fill in the Slack tokens and one LLM key when asked. Socket mode keeps an outbound connection open, so use an always-on plan: free instances go to sleep after 15 minutes without incoming traffic, and the bot would drop off with them.

Anything that runs a Docker container works as well (Fly.io, Railway, a small VPS). Point `DATABASE_URL` at a managed Postgres such as Neon or Supabase, both of which have free tiers.

## Database

The schema is created and upgraded automatically on startup.

| Table | |
| --- | --- |
| `member_analyses` | one row per analysis: score, confidence, segment, insights, research, team feedback, welcome DM status, and where it was posted |
| `analysis_jobs` | the queue: status, attempts, next retry, last error |
| `opted_out_members` | members who asked to be forgotten |
| `scheduled_runs` | last run of each scheduled task, so nothing runs twice |
