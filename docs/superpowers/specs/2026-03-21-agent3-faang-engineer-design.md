# Agent #3 — FAANG Senior Engineer Design Spec

**Date:** 2026-03-21
**Status:** Approved — Ready for Implementation

---

## Overview

Agent #3 transforms Claude Code into a 10x FAANG senior engineer persona for Suphasak. It is not a runtime agent — it is a **configuration layer** that shapes how Claude behaves in every terminal session: disciplined process, minimal code, fast shipping, automatic Notion logging after every deploy.

---

## Architecture

Three files. That's it.

| File | Purpose |
|------|---------|
| `~/.claude/CLAUDE.md` | Global persona: who Claude is as an engineer, universal process rules |
| `~/ooppyy-intel-agent/CLAUDE.md` | Project-specific rules: stack gotchas, env vars reference, deploy command |
| `scripts/log-build.mjs` | Post-deploy Notion logger: creates Dev Session Log entry with build name, date, commit SHA, tags |

---

## Components

### 1. `~/.claude/CLAUDE.md` — Global Engineering Persona

Loaded in every Claude Code session on this Mac, regardless of project.

**Contents:**
- Identity: 10x FAANG senior engineer, fast shipper, zero cowboy coding
- Process: plan → checkpoint 1 (design approval) → build → checkpoint 2 (deploy approval) → commit + push + deploy → log to Notion
- Code standards: small files, one responsibility, no premature abstraction, no over-engineering
- Commit rule: always `git add → git commit → git push` before `vercel --prod`
- Post-deploy rule: always run `node scripts/log-build.mjs` after successful deploy

### 2. `~/ooppyy-intel-agent/CLAUDE.md` — Project Rules

Loaded automatically when Claude Code is opened in this project folder. Overrides global defaults with project-specific context.

**Contents:**
- Stack: Vercel Serverless Functions + Groq (llama-3.3-70b-versatile) + Notion API + Telegram Bot API + Supabase
- CRITICAL gotcha: No backtick template literals in embedded client JS inside `api/plan.js` — use string concatenation
- Notion Status = `select` type (NOT Notion's newer `status` type)
- Cookie auth: `encodeURIComponent(PLAN_SECRET)` when setting, `decodeURIComponent` in `parseCookies()`
- Deploy command: `vercel --prod` from project root
- Post-deploy: `node scripts/log-build.mjs "description" "Tag1,Tag2"`
- GitHub: `git push origin main` before every deploy

### 3. `scripts/log-build.mjs` — Notion Build Logger

A lightweight Node.js ESM script. Run manually after every successful deploy.

**Usage:**
```bash
node scripts/log-build.mjs "Added Pokemon map to Planning HQ" "Planning HQ,Feature"
```

**What it creates in Notion Dev Session Log:**
- Name: the description passed as arg 1
- Date: today's date (auto)
- Status: Shipped
- Tags: parsed from comma-separated arg 2
- Commit SHA: read from `git rev-parse --short HEAD`

**Notion DB:** Dev Session Log (`32a94631-374e-8102-9d14-ef64c7f27ad4`) in Planning HQ page

---

## Process Flow

```
You describe feature
       ↓
Claude reads relevant files first
       ↓
CHECKPOINT 1: Design + approach presented
You approve (or tweak) → no code until approved
       ↓
Claude builds it
       ↓
CHECKPOINT 2: Diff shown, deploy confirmation requested
You approve → git add → git commit → git push → vercel --prod
       ↓
Deploy confirmed READY
       ↓
node scripts/log-build.mjs → Notion entry created
       ↓
Live URL delivered
```

---

## Error Handling

- Build failure → Claude debugs and fixes, no user involvement needed
- Deploy failure → Claude checks logs, fixes root cause, never uses `--no-verify`
- Notion logger failure → warns user, deploy still counts as complete
- Scope unclear → Claude asks before building, never after

---

## What This Is NOT

- Not a Telegram bot (terminal only)
- Not a runtime agent (no cron, no scheduled runs)
- Not a code generator that skips review (2 checkpoints always)
- Not limited to this project (global CLAUDE.md applies everywhere)

---

## Success Criteria

- Every build starts with a design checkpoint
- Every deploy is preceded by a git commit + push
- Every deployed build has a matching Notion Dev Session Log entry
- No surprise deploys, no cowboy commits
