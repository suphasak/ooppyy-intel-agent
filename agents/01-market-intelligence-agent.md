# Agent 01 — Market Intelligence Agent (Ooppyy)

## Identity
- **Name:** Ooppyy — Market Intelligence Agent
- **Type:** Scheduled Research Agent
- **Agent Version:** 1.5
- **Status:** Active
- **Deployed:** Vercel (ooppyy-intel-agent.vercel.app)

---

## Role
Ooppyy is a daily market intelligence agent that monitors global news, synthesises it into actionable briefings, and delivers them to the operator (Suphasak) every morning at 7:30am SGT.

It acts as a Chief of Staff intelligence function — filtering signal from noise across 4 domains and translating each story into "So What" implications specific to the operator's business context.

---

## Purpose
Provide a daily decision-support brief that:
- Surfaces relevant market, geopolitical, tech, and industry signals
- Interprets each signal through the lens of the operator's specific business context
- Identifies actionable opportunities and threats
- Builds a persistent knowledge base in Notion over time

---

## Operator Business Context
The "So What" angle is always tailored to:
1. **Fashion & Beauty Distribution** — operating in SEA (SG, TH, VN, ID), India, and GCC (UAE, Saudi Arabia)
2. **AI Consulting Agency** — based in Singapore, serving regional SMEs and enterprises

---

## Scope

### Covered Domains
| Domain | Emoji | Focus |
|--------|-------|-------|
| World & Politics | 🌍 | Geopolitics, trade, policy, diplomacy |
| Markets & Economics | 📈 | Equity markets, FX, commodities, macro trends |
| Technology & AI | 💻 | AI models, enterprise tech, SG/SEA tech ecosystem |
| Fashion & Beauty | 👗 | Retail trends, brand moves, SEA/India/GCC market shifts |

### Not In Scope
- Entertainment / celebrity news
- Sports
- Local SG lifestyle content
- Any content not relevant to the two business contexts above

---

## Inputs
| Input | Source | Type |
|-------|--------|------|
| World News | BBC World RSS | Free, automatic |
| Business News | BBC Business RSS | Free, automatic |
| Tech News | BBC Tech RSS + TechCrunch RSS | Free, automatic |
| Fashion News | WWD RSS + FashionUnited RSS | Free, automatic |

---

## Outputs
| Output | Destination | Frequency |
|--------|------------|-----------|
| Formatted brief | Telegram chat | Daily 7:30am SGT |
| Structured brief page | Notion (Intel Briefs) | Daily, auto-versioned |
| Interactive HTML view | ooppyy-intel-agent.vercel.app/api/view | Real-time, navigable |

---

## Technical Stack
| Component | Service | Cost |
|-----------|---------|------|
| AI summarisation | Groq (LLaMA-3.3-70b) | Free |
| News sources | RSS feeds | Free |
| Scheduling | Vercel Cron (23:30 UTC = 7:30am SGT) | Free |
| Knowledge base | Notion API | Free |
| Delivery | Telegram Bot API | Free |
| Hosting | Vercel Hobby | Free |
| Data storage | Supabase (PostgreSQL) | Free |
| **Total** | | **$0/month** |

---

## Agent Version History
| Version | Date | Changes |
|---------|------|---------|
| v1.0 | 2026-03-20 | Initial build — Gemini API (failed, quota=0) |
| v1.1 | 2026-03-20 | Switched to Groq + RSS feeds |
| v1.2 | 2026-03-20 | Added source links, icons, HTML view page |
| v1.3 | 2026-03-20 | JSON output, iOS widget UI, section tabs, date nav, PM Notion structure |
| v1.4 | 2026-03-20 | Virality scoring, compact single Telegram message, latest-only webapp, Notion Brief Tracker index page, old briefs retroactively renamed |
| v1.5 | 2026-03-20 | Supabase integration — briefs + stories stored in PostgreSQL for analytics and dashboards |

---

## Future Iterations (Backlog)
- [ ] Add Reuters / AP / FT RSS feeds for better market coverage
- [ ] Add SEA-specific news sources (CNA, The Business Times)
- [ ] Personalised subject scoring (rank stories by relevance)
- [ ] Weekly digest (summary of the week's top trends)
- [ ] Slack/email delivery option
- [ ] Multi-language support (Thai for SEA team)

---

## Related Agents (Planned)
| Agent | Purpose | Status |
|-------|---------|--------|
| 02 — Social Media Agent | Draft X/LinkedIn/IG posts from ideas | Planned |
| 03 — Research Agent | Deep dives on demand (competitors, markets) | Planned |
| 04 — GitHub Assistant | Monitor repos, summarise activity | Planned |
| 05 — Meeting Notes Agent | Auto-extract action items from transcripts | Planned |
