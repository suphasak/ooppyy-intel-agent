const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req, res) {
  try {
    const r = await fetch(
      `https://api.notion.com/v1/blocks/${process.env.NOTION_PAGE_ID}/children?page_size=100`,
      { headers: { 'Authorization': `Bearer ${process.env.NOTION_TOKEN}`, 'Notion-Version': '2022-06-28' } }
    );
    const data = await r.json();
    if (!r.ok) throw new Error('Failed to fetch Notion index');

    // Brief pages only — skip tracker and non-brief pages.
    // Only show briefs from 20 March 2026 onwards; take last 3.
    const cutoffDate = new Date('2026-03-20T00:00:00+08:00');
    const briefPages = data.results
      .filter(b => {
        if (b.type !== 'child_page') return false;
        const title = b.child_page?.title || '';
        if (!title.includes('Brief #')) return false;
        const d = extractDateFromTitle(title);
        return d && d >= cutoffDate;
      })
      .slice(-3);

    if (!briefPages.length) return res.setHeader('Content-Type', 'text/html').status(200).send(emptyPage());

    // Selected: ?id= param or latest
    const requestedId = req.query?.id;
    let selectedIdx = briefPages.length - 1;
    if (requestedId) {
      const found = briefPages.findIndex(p => p.id === requestedId);
      if (found !== -1) selectedIdx = found;
    }

    // Fetch Notion blocks for selected brief only
    const br = await fetch(
      `https://api.notion.com/v1/blocks/${briefPages[selectedIdx].id}/children?page_size=100`,
      { headers: { 'Authorization': `Bearer ${process.env.NOTION_TOKEN}`, 'Notion-Version': '2022-06-28' } }
    );
    const blocks = await br.json();
    const rawJson = (blocks.results || [])
      .filter(b => b.type === 'code')
      .map(b => b.code.rich_text.map(t => t.plain_text).join(''))
      .join('');

    let currentBrief = null;
    try { currentBrief = JSON.parse(rawJson); } catch {}
    if (!currentBrief) return res.setHeader('Content-Type', 'text/html').status(200).send(emptyPage());

    // Top stories from previous 2 briefs — pulled from Supabase (not Notion, not old iterations)
    const recentHighlights = [];
    if (SUPABASE_URL && SUPABASE_KEY) {
      const prevBriefNums = briefPages
        .slice(0, selectedIdx)
        .slice(-2)
        .reverse()
        .map(p => extractBriefNum(p.child_page?.title || ''))
        .filter(Boolean);

      if (prevBriefNums.length) {
        const rows = await Promise.all(
          prevBriefNums.map(num =>
            fetch(`${SUPABASE_URL}/rest/v1/stories?brief_num=eq.${num}&order=virality.desc&limit=1&select=*`, {
              headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
            }).then(r => r.ok ? r.json() : []).catch(() => [])
          )
        );
        const sectionMeta = {
          world:   { emoji: '🌍', color: '#0ea5e9' },
          markets: { emoji: '📈', color: '#22c55e' },
          tech:    { emoji: '💻', color: '#a855f7' },
          fashion: { emoji: '👗', color: '#ec4899' },
        };
        const prevPages = briefPages.slice(0, selectedIdx).slice(-2).reverse();
        rows.forEach((list, i) => {
          const story = Array.isArray(list) && list[0];
          if (!story) return;
          const meta = sectionMeta[story.section_key] || { emoji: '📰', color: '#888' };
          const pageDate = extractDateFromTitle(prevPages[i]?.child_page?.title || '');
          const dayLabel = pageDate ? formatTabDate(pageDate) : (i === 0 ? 'Yesterday' : '2 Days Ago');
          recentHighlights.push({
            story: { ...story, ...meta },
            dayLabel,
          });
        });
      }
    }

    // Date tabs — max 3, most recent first, showing actual dates
    const dateTabs = [...briefPages].reverse().map((page, i) => {
      const pageDate = extractDateFromTitle(page.child_page?.title || '');
      return {
        id: page.id,
        label: pageDate ? formatTabDate(pageDate) : `#${extractBriefNum(page.child_page?.title || '')}`,
        briefNum: extractBriefNum(page.child_page?.title || ''),
        isSelected: (briefPages.length - 1 - i) === selectedIdx,
      };
    });

    const html = renderHTML(currentBrief, recentHighlights, dateTabs);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=900');
    res.status(200).send(html);
  } catch (error) {
    res.status(500).setHeader('Content-Type', 'text/html').send(`
      <html><body style="background:#000;color:#fff;font-family:-apple-system,sans-serif;padding:2rem;text-align:center">
        <div style="font-size:3rem">⚠️</div><h2>${error.message}</h2></body></html>`);
  }
}

function extractBriefNum(title) {
  const m = title.match(/Brief #(\d+)/);
  return m ? parseInt(m[1]) : null;
}

function extractDateFromTitle(title) {
  // Title format: "📰 Brief #N — Thursday, 20 March 2026 [Agent v1.7]"
  const m = title.match(/—\s+([^[]+)\s+\[/);
  if (!m) return null;
  try { return new Date(m[1].trim()); } catch { return null; }
}

function formatTabDate(dateObj) {
  if (!dateObj || isNaN(dateObj)) return '';
  return dateObj.toLocaleDateString('en-SG', { month: 'short', day: 'numeric', timeZone: 'Asia/Singapore' });
}

function e(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderHTML(data, recentHighlights, dateTabs) {
  const { date, sections = [], opportunities = [], briefNum, agentVersion } = data;

  const categoryTabs = [
    { key: 'all', label: 'All', emoji: '⚡' },
    ...sections.map(s => ({ key: s.key, label: s.label.split(' ')[0], emoji: s.emoji })),
    { key: 'opps', label: 'Actions', emoji: '🎯' }
  ];

  const recentHTML = recentHighlights.length ? `
    <div class="recent-wrap">
      <div class="recent-label">📅 Recent Highlights</div>
      ${recentHighlights.map(({ story, dayLabel }) => `
        <div class="recent-card" style="--c:${e(story.color)}">
          <div class="recent-meta">${story.emoji} <span class="recent-day">${e(dayLabel)}</span> · Brief #${story.brief_num || ''} · 🔥${story.virality || ''}</div>
          <div class="recent-hl">${e(story.headline)}</div>
          <div class="recent-sw">${e(story.sowhat)}</div>
          ${story.source_url ? `<a href="${e(story.source_url)}" target="_blank" class="src-btn" style="margin-top:7px">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            ${e(story.source_name || 'Source')}
          </a>` : ''}
        </div>`).join('')}
    </div>` : '';

  const sectionsHTML = sections.map((section, si) => {
    const stories = (section.stories || []).map((story, i) => `
      <div class="story-card" onclick="toggle(this)" style="--c:${e(section.color)}">
        <div class="story-row">
          <div class="story-num" style="background:${e(section.color)}">${i + 1}</div>
          <div class="story-hl">${e(story.headline)}</div>
          <div class="chevron">›</div>
        </div>
        <div class="story-expand">
          ${story.source_url ? `<a href="${e(story.source_url)}" target="_blank" class="src-btn" onclick="event.stopPropagation()">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            ${e(story.source_name || 'Source')}
          </a>` : ''}
          <div class="sowhat">
            <div class="sowhat-label">💡 So What</div>
            <div class="sowhat-body">${e(story.sowhat)}</div>
          </div>
        </div>
      </div>`).join('');

    return `
    <div class="section" data-section="${e(section.key)}" style="--c:${e(section.color)};animation-delay:${si * 0.07}s">
      <div class="section-head">
        <span class="section-icon">${section.emoji}</span>
        <span class="section-title">${e(section.label)}</span>
        <span class="section-badge">${(section.stories || []).length}</span>
      </div>
      ${stories}
    </div>`;
  }).join('');

  const oppsHTML = opportunities.length ? `
    <div class="section" data-section="opps" style="--c:#f59e0b;animation-delay:${sections.length * 0.07}s">
      <div class="section-head">
        <span class="section-icon">🎯</span>
        <span class="section-title">OPPORTUNITIES & THREATS</span>
        <span class="section-badge">${opportunities.length}</span>
      </div>
      ${opportunities.map(o => `
        <div class="opp-row">
          <div class="opp-dot"></div>
          <div class="opp-text">${e(o)}</div>
        </div>`).join('')}
    </div>` : '';

  const dateTabsHTML = dateTabs.map(t => `
    <a class="dtab${t.isSelected ? ' active' : ''}" href="/api/view${t.isSelected ? '' : `?id=${t.id}`}">
      ${t.isSelected ? '<span class="dtab-dot"></span>' : ''}${e(t.label)}${t.briefNum ? ` <span class="dtab-num">#${t.briefNum}</span>` : ''}
    </a>`).join('');

  const categoryTabsHTML = categoryTabs.map(t => `
    <button class="tab${t.key === 'all' ? ' active' : ''}" data-tab="${t.key}" onclick="setTab('${t.key}')">
      ${t.emoji} ${t.label}
    </button>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <title>Ooppyy Intel #${briefNum || ''}</title>
  <style>
    /* ── DARK (default) ── */
    :root{
      --bg:#000;
      --topbar-bg:rgba(0,0,0,.88);
      --s1:rgba(28,28,30,.98);
      --s2:rgba(44,44,46,.7);
      --txt:#fff;
      --txt2:rgba(235,235,245,.55);
      --sep:rgba(84,84,88,.3);
      --pill-bg:rgba(255,255,255,.08);
      --pill-border:rgba(255,255,255,.1);
      --tab-bg:rgba(255,255,255,.07);
      --tab-active-bg:#fff;
      --tab-active-txt:#000;
      --dtab-active-bg:rgba(255,255,255,.14);
      --dtab-active-border:rgba(255,255,255,.2);
      --recent-bg:rgba(255,255,255,.04);
      --r:20px;
    }
    /* ── LIGHT ── */
    html.light{
      --bg:#f2f2f7;
      --topbar-bg:rgba(242,242,247,.92);
      --s1:#fff;
      --s2:rgba(242,242,247,.9);
      --txt:#000;
      --txt2:rgba(60,60,67,.55);
      --sep:rgba(60,60,67,.15);
      --pill-bg:rgba(0,0,0,.06);
      --pill-border:rgba(0,0,0,.1);
      --tab-bg:rgba(0,0,0,.06);
      --tab-active-bg:#000;
      --tab-active-txt:#fff;
      --dtab-active-bg:rgba(0,0,0,.12);
      --dtab-active-border:rgba(0,0,0,.2);
      --recent-bg:rgba(0,0,0,.03);
    }

    *{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
    html{background:var(--bg)}
    body{font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','Helvetica Neue',sans-serif;background:var(--bg);color:var(--txt);min-height:100dvh;padding-bottom:calc(env(safe-area-inset-bottom)+20px);transition:background .25s,color .25s}

    /* TOP BAR */
    .topbar{position:sticky;top:0;z-index:99;padding:50px 16px 8px;background:var(--topbar-bg);backdrop-filter:blur(24px) saturate(180%);-webkit-backdrop-filter:blur(24px) saturate(180%);border-bottom:1px solid var(--sep)}
    .topbar-row{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
    .agent-pill{display:flex;align-items:center;gap:8px;background:var(--pill-bg);border:1px solid var(--pill-border);border-radius:999px;padding:5px 12px 5px 8px;font-size:.75rem;font-weight:700;letter-spacing:.04em;color:var(--txt)}
    .live{width:7px;height:7px;border-radius:50%;background:#30d158;box-shadow:0 0 6px #30d158;animation:pulse 2s infinite;flex-shrink:0}
    @keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.5;transform:scale(.8)}}
    .topbar-actions{display:flex;gap:8px;align-items:center}
    .theme-btn{background:var(--pill-bg);border:1px solid var(--pill-border);color:var(--txt);font-size:.78rem;font-weight:600;padding:6px 10px;border-radius:999px;cursor:pointer;line-height:1}
    .theme-btn:active{opacity:.6}
    .share-btn{background:rgba(10,132,255,.15);border:1px solid rgba(10,132,255,.3);color:#0a84ff;font-size:.78rem;font-weight:600;padding:6px 12px;border-radius:999px;cursor:pointer;display:flex;align-items:center;gap:5px}
    .share-btn:active{opacity:.6}

    /* DATE TABS */
    .dtabs{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;padding-bottom:6px;margin-bottom:4px}
    .dtabs::-webkit-scrollbar{display:none}
    .dtab{flex-shrink:0;display:flex;align-items:center;gap:5px;background:var(--tab-bg);border:1px solid var(--sep);border-radius:999px;color:var(--txt2);font-size:.75rem;font-weight:600;padding:5px 12px;cursor:pointer;white-space:nowrap;transition:all .2s;text-decoration:none}
    .dtab.active{background:var(--dtab-active-bg);color:var(--txt);border-color:var(--dtab-active-border)}
    .dtab:active{transform:scale(.95)}
    .dtab-dot{width:6px;height:6px;border-radius:50%;background:#30d158;box-shadow:0 0 5px #30d158;flex-shrink:0}
    .dtab-num{opacity:.45;font-size:.68rem}

    /* CATEGORY TABS */
    .tabs{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;padding-bottom:2px}
    .tabs::-webkit-scrollbar{display:none}
    .tab{flex-shrink:0;background:var(--tab-bg);border:1px solid var(--sep);border-radius:999px;color:var(--txt2);font-size:.75rem;font-weight:600;padding:5px 12px;cursor:pointer;white-space:nowrap;transition:all .2s}
    .tab.active{background:var(--tab-active-bg);color:var(--tab-active-txt);border-color:transparent}
    .tab:active{transform:scale(.95)}

    /* HERO */
    .hero{padding:20px 16px 12px}
    .hero-eyebrow{font-size:.68rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--txt2);margin-bottom:6px}
    .hero-title{font-size:clamp(1.5rem,6vw,2rem);font-weight:800;letter-spacing:-.03em;line-height:1.1;color:var(--txt)}
    .hero-meta{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}
    .meta-tag{font-size:.7rem;font-weight:600;color:var(--txt2);background:var(--tab-bg);border:1px solid var(--sep);border-radius:999px;padding:3px 10px}

    /* RECENT HIGHLIGHTS */
    .recent-wrap{padding:0 12px 4px}
    .recent-label{font-size:.65rem;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--txt2);margin-bottom:8px;padding-left:2px}
    .recent-card{background:var(--recent-bg);border:1px solid var(--sep);border-left:3px solid var(--c,#888);border-radius:14px;padding:10px 12px;margin-bottom:7px}
    .recent-meta{font-size:.65rem;font-weight:700;color:var(--txt2);letter-spacing:.04em;margin-bottom:4px}
    .recent-day{color:var(--txt);font-weight:800}
    .recent-hl{font-size:.84rem;font-weight:600;line-height:1.4;color:var(--txt);margin-bottom:5px}
    .recent-sw{font-size:.76rem;line-height:1.45;color:var(--txt2);border-left:2px solid rgba(245,158,11,.4);padding-left:8px}

    /* SECTIONS */
    .feed{padding:0 12px}
    .section{background:var(--s1);border:1px solid var(--sep);border-left:3px solid var(--c,#fff);border-radius:var(--r);margin-bottom:10px;overflow:hidden;opacity:0;transform:translateY(14px);animation:up .4s cubic-bezier(.34,1.56,.64,1) forwards}
    @keyframes up{to{opacity:1;transform:none}}
    .section.hidden{display:none}
    .section-head{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid var(--sep)}
    .section-icon{font-size:1.2rem;width:34px;height:34px;border-radius:10px;background:color-mix(in srgb,var(--c) 15%,transparent);display:flex;align-items:center;justify-content:center;flex-shrink:0}
    .section-title{font-size:.73rem;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--c);flex:1}
    .section-badge{font-size:.68rem;font-weight:700;color:var(--txt2);background:var(--s2);padding:2px 8px;border-radius:999px}

    /* STORIES */
    .story-card{padding:11px 14px;border-bottom:1px solid var(--sep);cursor:pointer;transition:background .15s}
    .story-card:last-child{border-bottom:none}
    .story-card:active{background:var(--recent-bg)}
    .story-row{display:flex;align-items:flex-start;gap:9px}
    .story-num{min-width:20px;height:20px;border-radius:50%;color:#fff;font-size:.68rem;font-weight:800;display:flex;align-items:center;justify-content:center;margin-top:1px;flex-shrink:0}
    html.light .story-num{color:#000;filter:brightness(1.2)}
    .story-hl{font-size:.88rem;font-weight:600;line-height:1.45;flex:1;color:var(--txt)}
    .chevron{color:var(--txt2);font-size:1.1rem;transition:transform .25s;flex-shrink:0}
    .story-card.open .chevron{transform:rotate(90deg)}
    .story-expand{max-height:0;overflow:hidden;transition:max-height .35s ease;padding-left:29px}
    .story-card.open .story-expand{max-height:280px}
    .src-btn{display:inline-flex;align-items:center;gap:5px;background:rgba(10,132,255,.12);color:#0a84ff;font-size:.73rem;font-weight:600;padding:5px 10px;border-radius:999px;text-decoration:none;margin:9px 0 7px;border:1px solid rgba(10,132,255,.2)}
    .src-btn:active{background:rgba(10,132,255,.25)}
    .sowhat{background:rgba(245,158,11,.07);border-left:2px solid #f59e0b;border-radius:0 8px 8px 0;padding:8px 10px;margin-bottom:8px}
    .sowhat-label{font-size:.65rem;font-weight:800;letter-spacing:.07em;text-transform:uppercase;color:#f59e0b;margin-bottom:3px}
    .sowhat-body{font-size:.82rem;line-height:1.55;color:var(--txt2)}

    /* OPPS */
    .opp-row{display:flex;align-items:flex-start;gap:10px;padding:10px 14px;border-bottom:1px solid var(--sep)}
    .opp-row:last-child{border-bottom:none}
    .opp-dot{min-width:8px;height:8px;border-radius:50%;background:#f59e0b;box-shadow:0 0 5px rgba(245,158,11,.5);margin-top:6px;flex-shrink:0}
    .opp-text{font-size:.86rem;line-height:1.5;color:var(--txt)}

    /* FOOTER */
    .footer{padding:16px;text-align:center;color:var(--txt2);font-size:.72rem;line-height:1.7}
    .footer a{color:#0a84ff;text-decoration:none}

    /* TOAST */
    .toast{position:fixed;bottom:calc(28px + env(safe-area-inset-bottom));left:50%;transform:translateX(-50%) translateY(80px);background:var(--s1);color:var(--txt);font-size:.83rem;font-weight:600;padding:11px 20px;border-radius:999px;backdrop-filter:blur(20px);z-index:999;transition:transform .3s cubic-bezier(.34,1.56,.64,1);border:1px solid var(--sep)}
    .toast.show{transform:translateX(-50%) translateY(0)}
  </style>
</head>
<body>

<div class="topbar">
  <div class="topbar-row">
    <div class="agent-pill"><div class="live"></div>Ooppyy · Market Intelligence</div>
    <div class="topbar-actions">
      <button class="theme-btn" id="theme-btn" onclick="toggleTheme()">🌙</button>
      <button class="share-btn" onclick="share()">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
        Share
      </button>
    </div>
  </div>
  <div class="dtabs">${dateTabsHTML}</div>
  <div class="tabs">${categoryTabsHTML}</div>
</div>

<div class="hero">
  <div class="hero-eyebrow">Intelligence Brief ${briefNum ? `#${briefNum}` : ''}</div>
  <div class="hero-title">Your Daily<br>Market Edge</div>
  <div class="hero-meta">
    <span class="meta-tag">📅 ${e(date || '')}</span>
    ${agentVersion ? `<span class="meta-tag">🤖 v${e(agentVersion)}</span>` : ''}
    <span class="meta-tag">📰 ${sections.reduce((n,s) => n+(s.stories||[]).length,0)} stories</span>
  </div>
</div>

${recentHTML}

<div class="feed" id="feed">
  ${sectionsHTML}
  ${oppsHTML}
</div>

<div class="footer">
  Ooppyy · Market Intelligence Agent${agentVersion ? ` v${agentVersion}` : ''}<br>
  <a href="/api/view">Daily Brief</a> · <a href="/api/scout">Social Scout</a>
</div>

<div class="toast" id="toast">✅ Link copied!</div>

<script>
  // Theme
  (function() {
    const saved = localStorage.getItem('theme');
    if (saved === 'light') {
      document.documentElement.classList.add('light');
      document.getElementById('theme-btn').textContent = '☀️';
    }
  })();

  function toggleTheme() {
    const isLight = document.documentElement.classList.toggle('light');
    localStorage.setItem('theme', isLight ? 'light' : 'dark');
    document.getElementById('theme-btn').textContent = isLight ? '☀️' : '🌙';
  }

  function toggle(el) { el.classList.toggle('open'); }

  function setTab(key) {
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === key));
    document.querySelectorAll('.section').forEach(s => {
      s.classList.toggle('hidden', key !== 'all' && s.dataset.section !== key);
    });
  }

  function share() {
    const url = window.location.href;
    if (navigator.share) {
      navigator.share({ title: 'Ooppyy Intel Brief', text: 'Daily market intelligence', url }).catch(()=>{});
    } else {
      navigator.clipboard.writeText(url).then(() => {
        const t = document.getElementById('toast');
        t.classList.add('show');
        setTimeout(() => t.classList.remove('show'), 2200);
      });
    }
  }
</script>
</body>
</html>`;
}

function emptyPage() {
  return `<!DOCTYPE html><html><body style="background:#000;color:#fff;font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;height:100dvh;text-align:center">
    <div><div style="font-size:4rem">🌙</div><h2 style="margin:1rem 0;font-weight:700">No briefs yet</h2><p style="color:#666">The agent runs at 7:30am SGT.</p></div>
  </body></html>`;
}
