# Agent #3 — FAANG Senior Engineer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Configure Claude Code as a 10x FAANG senior engineer with disciplined process, automatic GitHub commits before every deploy, and Notion logging after every deploy.

**Architecture:** Three files: a global `~/.claude/CLAUDE.md` (persona + process rules for all projects), a project-level `~/ooppyy-intel-agent/CLAUDE.md` (stack gotchas and env vars), and `scripts/log-build.mjs` (post-deploy Notion logger). No runtime agent — this is a configuration layer.

**Tech Stack:** Node.js ESM, Notion REST API, `git rev-parse` for commit SHA, `child_process.execSync` for git, `fetch` for Notion API calls.

---

## File Map

| Action | Path | Purpose |
|--------|------|---------|
| Create | `~/.claude/CLAUDE.md` | Global engineering persona — applies to every project on this Mac |
| Create | `~/ooppyy-intel-agent/CLAUDE.md` | Project rules — auto-loaded when in this folder |
| Create | `scripts/log-build.mjs` | Post-deploy Notion logger |

---

### Task 1: Global Engineering Persona (`~/.claude/CLAUDE.md`)

**Files:**
- Create: `~/.claude/CLAUDE.md`

- [ ] **Step 1: Create the global CLAUDE.md**

```markdown
# Ooppyy Engineering Persona

You are a 10x FAANG senior engineer. You ship fast, clean, and minimal. You never guess, never cowboy-code, and never deploy without committing first.

## Identity

- Fast-shipping serverless tools is the primary mode
- Suphasak is non-technical — translate intent into code, explain decisions clearly
- You handle everything end-to-end: from idea to live URL
- Minimum viable first, iterate after

## Process (ALWAYS follow this order)

1. Read relevant files before touching anything
2. CHECKPOINT 1 — Present design + approach, wait for approval before writing code
3. Build it (follow project CLAUDE.md for stack rules)
4. CHECKPOINT 2 — Show what changed, ask for deploy confirmation
5. On approval: `git add [files] → git commit → git push origin main → vercel --prod`
6. After deploy confirms READY: `node scripts/log-build.mjs "description" "Tag1,Tag2"`
7. Deliver the live URL

## Code Standards

- Small files, one clear responsibility each
- No premature abstraction — three similar lines > a helper nobody asked for
- No over-engineering — build for today's requirements, not hypothetical futures
- No backwards-compatibility hacks for code that isn't used
- Comment only where logic isn't self-evident

## Commit Rules

- Always stage specific files (never `git add .` blindly)
- Commit message format: `type(scope): description` (feat, fix, chore, docs)
- NEVER use `--no-verify` or `--force` on main without explicit user instruction
- NEVER amend a published commit

## Deploy Rules

- `vercel --prod` only from the project root
- Always confirm production deploy intent before running
- Check deploy logs after — if state is not READY, investigate before declaring done

## Error Handling

- Build fails → debug and fix, no need to involve Suphasak
- Deploy fails → check `vercel logs`, fix root cause
- Scope unclear → ask before building, never after
- Notion logger fails → warn Suphasak but deploy still counts as done
```

- [ ] **Step 2: Verify it loads**

Open a new Claude Code session (or restart) and confirm the persona is active. You should see the CLAUDE.md content referenced in the system context.

- [ ] **Step 3: Commit**

```bash
# This file is outside the project repo — no commit needed
# Just verify: cat ~/.claude/CLAUDE.md
cat ~/.claude/CLAUDE.md
```

---

### Task 2: Project Rules (`~/ooppyy-intel-agent/CLAUDE.md`)

**Files:**
- Create: `~/ooppyy-intel-agent/CLAUDE.md`

- [ ] **Step 1: Create the project CLAUDE.md**

```markdown
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
```

- [ ] **Step 2: Verify file exists**

```bash
cat ~/ooppyy-intel-agent/CLAUDE.md
```

Expected: full file contents printed

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "chore: add project CLAUDE.md with stack rules and gotchas"
```

---

### Task 3: Notion Build Logger (`scripts/log-build.mjs`)

**Files:**
- Create: `scripts/log-build.mjs`

- [ ] **Step 1: Create the scripts directory and logger**

```bash
mkdir -p scripts
```

```js
// scripts/log-build.mjs
import { execSync } from 'child_process';

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DB_ID = '32a94631-374e-8102-9d14-ef64c7f27ad4';

if (!NOTION_TOKEN) {
  console.error('ERROR: NOTION_TOKEN not set. Run: source .env.local or set env var.');
  process.exit(1);
}

const description = process.argv[2];
const tagsRaw = process.argv[3] || '';

if (!description) {
  console.error('Usage: node scripts/log-build.mjs "What you built" "Tag1,Tag2"');
  process.exit(1);
}

// Get commit SHA
let commitSha = 'unknown';
try {
  commitSha = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
} catch (e) {
  console.warn('Warning: could not read git SHA —', e.message);
}

const today = new Date().toISOString().split('T')[0];

const tags = tagsRaw
  ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean).map(name => ({ name }))
  : [];

const body = {
  parent: { database_id: DB_ID },
  properties: {
    Name: {
      title: [{ text: { content: description } }]
    },
    Date: {
      date: { start: today }
    },
    Status: {
      select: { name: 'Shipped' }
    },
    Tags: {
      multi_select: tags
    }
  }
};

// Add commit SHA as a note in the page body if available
const children = commitSha !== 'unknown' ? [
  {
    object: 'block',
    type: 'paragraph',
    paragraph: {
      rich_text: [{ type: 'text', text: { content: 'Commit: ' + commitSha } }]
    }
  }
] : [];

if (children.length) body.children = children;

const res = await fetch('https://api.notion.com/v1/pages', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + NOTION_TOKEN,
    'Content-Type': 'application/json',
    'Notion-Version': '2022-06-28'
  },
  body: JSON.stringify(body)
});

if (!res.ok) {
  const err = await res.text();
  console.error('Notion API error:', err);
  process.exit(1);
}

const data = await res.json();
console.log('Logged to Notion:', data.url);
console.log('  Build:', description);
console.log('  Commit:', commitSha);
console.log('  Tags:', tags.map(t => t.name).join(', ') || 'none');
```

- [ ] **Step 2: Test the logger end-to-end**

```bash
# Pull env vars locally first (NOTION_TOKEN must be set)
source <(grep NOTION_TOKEN .env.local | sed 's/^/export /')

node scripts/log-build.mjs "Test — Agent #3 logger setup" "Intel Agent,Feature"
```

Expected output:
```
Logged to Notion: https://www.notion.so/...
  Build: Test — Agent #3 logger setup
  Commit: <sha>
  Tags: Intel Agent, Feature
```

Verify the entry appears in Notion Dev Session Log.

- [ ] **Step 3: Commit**

```bash
git add scripts/log-build.mjs
git commit -m "feat(agent3): add post-deploy Notion build logger"
git push origin main
```

- [ ] **Step 4: Log this build to Notion**

```bash
node scripts/log-build.mjs "Agent #3 FAANG engineer setup — CLAUDE.md + build logger" "Intel Agent,Feature"
```

---

## Verification Checklist

- [ ] `~/.claude/CLAUDE.md` exists and loads in new Claude Code sessions
- [ ] `~/ooppyy-intel-agent/CLAUDE.md` exists and is committed to git
- [ ] `scripts/log-build.mjs` runs successfully and creates a Notion entry
- [ ] Notion Dev Session Log shows the test entry with correct date, status=Shipped, tags
- [ ] Next feature build uses the 2-checkpoint process automatically
