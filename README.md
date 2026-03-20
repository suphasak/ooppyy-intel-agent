# Ooppyy — Market Intelligence Agent

> Agent #01 · Daily morning intelligence brief · Delivered to Telegram at 7:30am SGT

## What it does

Every morning at 7:30am Singapore time, this agent:
1. Fetches latest news from 6 free RSS feeds (BBC, TechCrunch, WWD, FashionUnited)
2. Asks Groq AI to analyse and score each story by virality + relevance
3. Delivers a compact brief to Telegram — top stories ranked by impact
4. Saves a full structured brief to Notion with PM metadata
5. Renders a beautiful interactive HTML brief at `/api/view`

## Stack

| Component | Service | Cost |
|-----------|---------|------|
| AI | Groq (LLaMA-3.3-70b) | Free |
| News | RSS feeds | Free |
| Scheduling | Vercel Cron | Free |
| Knowledge base | Notion API | Free |
| Delivery | Telegram Bot API | Free |
| Hosting | Vercel Hobby | Free |
| **Total** | | **$0/month** |

## Live URLs

- **HTML Brief:** https://ooppyy-intel-agent.vercel.app/api/view
- **Trigger manually:** https://ooppyy-intel-agent.vercel.app/api/brief

## Project structure

```
api/
  brief.js      # Main agent — fetches news, generates brief, sends everywhere
  view.js       # HTML renderer — reads latest brief from Notion, renders iOS-style UI
agents/
  01-market-intelligence-agent.md   # Agent role, scope, version history
vercel.json     # Cron schedule (23:30 UTC = 7:30am SGT)
```

## Environment variables

| Variable | Description |
|----------|-------------|
| `GROQ_API_KEY` | Groq API key (free at console.groq.com) |
| `NOTION_TOKEN` | Notion integration token |
| `NOTION_PAGE_ID` | ID of the Intel Briefs parent page |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token |
| `TELEGRAM_CHAT_ID` | Your Telegram chat ID |

## Agent version history

| Version | Changes |
|---------|---------|
| v1.0 | Initial build (Gemini — failed) |
| v1.1 | Groq + RSS feeds |
| v1.2 | Source links + HTML view |
| v1.3 | JSON output, iOS UI, tabs, Notion PM structure |
| v1.4 | Virality scoring, compact Telegram, latest-only webapp, Brief Tracker |

## Part of the Ooppyy Agent System

| Agent | Purpose | Status |
|-------|---------|--------|
| **#01 Market Intelligence** | Daily news brief | ✅ Active |
| #02 Social Media | Draft posts from ideas | 🔜 Planned |
| #03 Research | Deep dives on demand | 🔜 Planned |
| #04 GitHub Assistant | Repo monitoring | 🔜 Planned |
