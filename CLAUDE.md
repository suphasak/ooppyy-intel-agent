# Ooppyy Intel Agent — Project Rules

Stack: Vercel Serverless Functions (Node.js) + Groq (llama-3.3-70b-versatile) + Notion API + Telegram Bot API + Supabase

## Deploy

```bash
vercel --prod
# from ~/ooppyy-intel-agent/
```

After deploy: `node scripts/log-build.mjs "What you built" "Tag1,Tag2"`
Before deploy: `git push origin main`

## CRITICAL: No Backtick Template Literals in Embedded Client JS

`api/plan.js` uses a server-side template literal (`return \`...\``) to render HTML.
Any backtick inside the returned string — even in client-side JS — terminates the outer template literal early.

**WRONG** (crashes with SyntaxError: Unexpected token 'export'):
```js
html += `<div class="tile t${MAP[r][c]}"></div>`;
```

**CORRECT** — string concatenation only:
```js
html += '<div class="tile t' + MAP[r][c] + '"></div>';
```

## Notion Property Types

Status fields in ALL databases use `select` type (NOT Notion's newer `status` type).

WRONG: `{ status: { name: 'Done' } }`
CORRECT: `{ select: { name: 'Done' } }`

Database IDs:
- Goals DB: in NOTION_GOALS_DB_ID env var
- Projects DB: in NOTION_PROJECTS_DB_ID env var
- Tasks DB: in NOTION_TASKS_DB_ID env var
- Dev Session Log DB: 32a94631-374e-8102-9d14-ef64c7f27ad4

## Cookie Auth

```js
// Set cookie (login):
res.setHeader('Set-Cookie', 'ooppyy_plan=' + encodeURIComponent(process.env.PLAN_SECRET));

// Read cookie (parseCookies already decodes):
cookies.ooppyy_plan !== process.env.PLAN_SECRET.trim()
```

## GitHub

Remote: `origin https://github.com/suphasak/ooppyy-intel-agent.git`
Always push before deploying: `git push origin main`

## Available Env Vars (all set in Vercel)

GROQ_API_KEY, NOTION_TOKEN, NOTION_PAGE_ID, NOTION_PLANNING_PAGE_ID,
NOTION_GOALS_DB_ID, NOTION_PROJECTS_DB_ID, NOTION_TASKS_DB_ID,
NOTION_MISSION_PAGE_ID, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID,
SUPABASE_URL, SUPABASE_SERVICE_KEY, PLAN_SECRET
