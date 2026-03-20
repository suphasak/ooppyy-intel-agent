export default async function handler(req, res) {
  try {
    const r = await fetch(
      `https://api.notion.com/v1/blocks/${process.env.NOTION_PAGE_ID}/children?page_size=100`,
      { headers: { 'Authorization': `Bearer ${process.env.NOTION_TOKEN}`, 'Notion-Version': '2022-06-28' } }
    );
    const data = await r.json();
    if (!r.ok) throw new Error('Failed to fetch Notion index');

    // Only brief pages (skip tracker and other pages)
    const briefPages = data.results.filter(b =>
      b.type === 'child_page' && (b.child_page?.title || '').includes('Brief #')
    );
    if (!briefPages.length) return res.setHeader('Content-Type', 'text/html').status(200).send(emptyPage());

    // Selected brief: ?id= param or default to latest
    const requestedId = req.query?.id;
    let selectedIdx = briefPages.length - 1;
    if (requestedId) {
      const found = briefPages.findIndex(p => p.id === requestedId);
      if (found !== -1) selectedIdx = found;
    }

    // Fetch selected brief + 2 previous in parallel
    const pagesToFetch = [
      briefPages[selectedIdx],
      briefPages[selectedIdx - 1],
      briefPages[selectedIdx - 2],
    ].filter(Boolean);

    const blocksResults = await Promise.all(
      pagesToFetch.map(page =>
        fetch(`https://api.notion.com/v1/blocks/${page.id}/children?page_size=100`, {
          headers: { 'Authorization': `Bearer ${process.env.NOTION_TOKEN}`, 'Notion-Version': '2022-06-28' }
        }).then(r => r.json())
      )
    );

    const briefs = blocksResults.map(blocks => {
      const codeBlocks = (blocks.results || []).filter(b => b.type === 'code');
      if (!codeBlocks.length) return null;
      const rawJson = codeBlocks.map(b => b.code.rich_text.map(t => t.plain_text).join('')).join('');
      try { return JSON.parse(rawJson); } catch { return null; }
    });

    const currentBrief = briefs[0];
    if (!currentBrief) return res.setHeader('Content-Type', 'text/html').status(200).send(emptyPage());

    const previousBriefs = briefs.slice(1).filter(Boolean);

    // Build date tabs — most recent first
    const dateTabs = [...briefPages].reverse().map((page, i) => {
      const origIdx = briefPages.length - 1 - i;
      return {
        id: page.id,
        label: shortLabel(page.child_page?.title || '', i),
        briefNum: extractBriefNum(page.child_page?.title || ''),
        isSelected: origIdx === selectedIdx,
      };
    });

    const html = renderHTML(currentBrief, previousBriefs, dateTabs);
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

function shortLabel(title, posFromLatest) {
  if (posFromLatest === 0) return 'Today';
  if (posFromLatest === 1) return 'Yesterday';
  // Extract "20 Mar" from title like "📰 Brief #9 — Thursday, 20 March 2026 [Agent v1.5]"
  const m = title.match(/—\s*\w+,\s*(\d+)\s+(\w{3})/);
  if (m) return `${m[2]} ${m[1]}`;
  const n = extractBriefNum(title);
  return n ? `#${n}` : '—';
}

function e(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderHTML(data, previousBriefs, dateTabs) {
  const { date, sections = [], opportunities = [], briefNum, agentVersion, sourcesUsed = [] } = data;

  const categoryTabs = [
    { key: 'all', label: 'All', emoji: '⚡' },
    ...sections.map(s => ({ key: s.key, label: s.label.split(' ')[0], emoji: s.emoji })),
    { key: 'opps', label: 'Actions', emoji: '🎯' }
  ];

  // Recent highlights from previous 2 days
  const recentHighlights = previousBriefs.map(brief => {
    const allStories = (brief.sections || []).flatMap(s =>
      (s.stories || []).map(st => ({ ...st, emoji: s.emoji, color: s.color }))
    ).sort((a, b) => (b.virality || 0) - (a.virality || 0));
    const top = allStories[0];
    return top ? { story: top, date: brief.date, briefNum: brief.briefNum } : null;
  }).filter(Boolean);

  const recentHTML = recentHighlights.length ? `
    <div class="recent-wrap">
      <div class="recent-label">📅 Recent Highlights</div>
      ${recentHighlights.map(({ story, date: d, briefNum: n }) => `
        <div class="recent-card" style="--c:${e(story.color || '#888')}">
          <div class="recent-meta">${story.emoji} ${e(d || '')} ${n ? `· #${n}` : ''} · 🔥${story.virality || ''}</div>
          <div class="recent-hl">${e(story.headline)}</div>
          <div class="recent-sw">${e(story.sowhat)}</div>
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
    :root{--bg:#000;--s1:rgba(28,28,30,.98);--s2:rgba(44,44,46,.7);--txt:rgba(255,255,255,1);--txt2:rgba(235,235,245,.55);--sep:rgba(84,84,88,.3);--r:20px}
    *{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
    html{background:var(--bg)}
    body{font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','Helvetica Neue',sans-serif;background:var(--bg);color:var(--txt);min-height:100dvh;padding-bottom:calc(env(safe-area-inset-bottom)+20px)}

    /* TOP BAR */
    .topbar{position:sticky;top:0;z-index:99;padding:50px 16px 8px;background:rgba(0,0,0,.88);backdrop-filter:blur(24px) saturate(180%);-webkit-backdrop-filter:blur(24px) saturate(180%);border-bottom:1px solid var(--sep)}
    .topbar-row{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
    .agent-pill{display:flex;align-items:center;gap:8px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.1);border-radius:999px;padding:5px 12px 5px 8px;font-size:.75rem;font-weight:700;letter-spacing:.04em}
    .live{width:7px;height:7px;border-radius:50%;background:#30d158;box-shadow:0 0 6px #30d158;animation:pulse 2s infinite}
    @keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.5;transform:scale(.8)}}
    .share-btn{background:rgba(10,132,255,.15);border:1px solid rgba(10,132,255,.3);color:#0a84ff;font-size:.78rem;font-weight:600;padding:6px 12px;border-radius:999px;cursor:pointer;display:flex;align-items:center;gap:5px;text-decoration:none}
    .share-btn:active{opacity:.6}

    /* DATE TABS */
    .dtabs{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;padding-bottom:6px;margin-bottom:4px}
    .dtabs::-webkit-scrollbar{display:none}
    .dtab{flex-shrink:0;display:flex;align-items:center;gap:5px;background:rgba(255,255,255,.06);border:1px solid var(--sep);border-radius:999px;color:var(--txt2);font-size:.75rem;font-weight:600;padding:5px 12px;cursor:pointer;white-space:nowrap;transition:all .2s;text-decoration:none}
    .dtab.active{background:rgba(255,255,255,.14);color:var(--txt);border-color:rgba(255,255,255,.2)}
    .dtab:active{transform:scale(.95)}
    .dtab-dot{width:6px;height:6px;border-radius:50%;background:#30d158;box-shadow:0 0 5px #30d158;flex-shrink:0}
    .dtab-num{opacity:.5;font-size:.68rem}

    /* CATEGORY TABS */
    .tabs{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;padding-bottom:2px}
    .tabs::-webkit-scrollbar{display:none}
    .tab{flex-shrink:0;background:rgba(255,255,255,.07);border:1px solid var(--sep);border-radius:999px;color:var(--txt2);font-size:.75rem;font-weight:600;padding:5px 12px;cursor:pointer;white-space:nowrap;transition:all .2s}
    .tab.active{background:var(--txt);color:#000;border-color:transparent}
    .tab:active{transform:scale(.95)}

    /* HERO */
    .hero{padding:20px 16px 12px}
    .hero-eyebrow{font-size:.68rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--txt2);margin-bottom:6px}
    .hero-title{font-size:clamp(1.5rem,6vw,2rem);font-weight:800;letter-spacing:-.03em;line-height:1.1;background:linear-gradient(135deg,#fff 30%,rgba(255,255,255,.6));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
    .hero-meta{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}
    .meta-tag{font-size:.7rem;font-weight:600;color:var(--txt2);background:rgba(255,255,255,.07);border:1px solid var(--sep);border-radius:999px;padding:3px 10px}

    /* RECENT HIGHLIGHTS */
    .recent-wrap{padding:0 12px 4px}
    .recent-label{font-size:.65rem;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--txt2);margin-bottom:8px;padding-left:2px}
    .recent-card{background:rgba(255,255,255,.04);border:1px solid var(--sep);border-left:3px solid var(--c,#888);border-radius:14px;padding:10px 12px;margin-bottom:7px}
    .recent-meta{font-size:.65rem;font-weight:700;color:var(--txt2);letter-spacing:.04em;margin-bottom:4px}
    .recent-hl{font-size:.84rem;font-weight:600;line-height:1.4;color:var(--txt);margin-bottom:5px}
    .recent-sw{font-size:.76rem;line-height:1.45;color:rgba(235,235,245,.6);border-left:2px solid rgba(245,158,11,.4);padding-left:8px}

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
    .story-card:active{background:rgba(255,255,255,.04)}
    .story-row{display:flex;align-items:flex-start;gap:9px}
    .story-num{min-width:20px;height:20px;border-radius:50%;color:#000;font-size:.68rem;font-weight:800;display:flex;align-items:center;justify-content:center;margin-top:1px;flex-shrink:0}
    .story-hl{font-size:.88rem;font-weight:600;line-height:1.45;flex:1}
    .chevron{color:var(--txt2);font-size:1.1rem;transition:transform .25s;flex-shrink:0}
    .story-card.open .chevron{transform:rotate(90deg)}
    .story-expand{max-height:0;overflow:hidden;transition:max-height .35s ease;padding-left:29px}
    .story-card.open .story-expand{max-height:280px}
    .src-btn{display:inline-flex;align-items:center;gap:5px;background:rgba(10,132,255,.12);color:#0a84ff;font-size:.73rem;font-weight:600;padding:5px 10px;border-radius:999px;text-decoration:none;margin:9px 0 7px;border:1px solid rgba(10,132,255,.2)}
    .src-btn:active{background:rgba(10,132,255,.25)}
    .sowhat{background:rgba(245,158,11,.07);border-left:2px solid #f59e0b;border-radius:0 8px 8px 0;padding:8px 10px;margin-bottom:8px}
    .sowhat-label{font-size:.65rem;font-weight:800;letter-spacing:.07em;text-transform:uppercase;color:#f59e0b;margin-bottom:3px}
    .sowhat-body{font-size:.82rem;line-height:1.55;color:rgba(235,235,245,.78)}

    /* OPPS */
    .opp-row{display:flex;align-items:flex-start;gap:10px;padding:10px 14px;border-bottom:1px solid var(--sep)}
    .opp-row:last-child{border-bottom:none}
    .opp-dot{min-width:8px;height:8px;border-radius:50%;background:#f59e0b;box-shadow:0 0 5px rgba(245,158,11,.5);margin-top:6px;flex-shrink:0}
    .opp-text{font-size:.86rem;line-height:1.5;color:rgba(235,235,245,.85)}

    /* FOOTER */
    .footer{padding:16px;text-align:center;color:var(--txt2);font-size:.72rem;line-height:1.7}
    .footer a{color:#0a84ff;text-decoration:none}

    /* TOAST */
    .toast{position:fixed;bottom:calc(28px + env(safe-area-inset-bottom));left:50%;transform:translateX(-50%) translateY(80px);background:rgba(44,44,46,.95);color:#fff;font-size:.83rem;font-weight:600;padding:11px 20px;border-radius:999px;backdrop-filter:blur(20px);z-index:999;transition:transform .3s cubic-bezier(.34,1.56,.64,1);border:1px solid var(--sep)}
    .toast.show{transform:translateX(-50%) translateY(0)}
  </style>
</head>
<body>

<div class="topbar">
  <div class="topbar-row">
    <div class="agent-pill"><div class="live"></div>Ooppyy · Market Intelligence</div>
    <button class="share-btn" onclick="share()">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
      Share
    </button>
  </div>
  <div class="dtabs">${dateTabsHTML}</div>
  <div class="tabs">${categoryTabsHTML}</div>
</div>

<div class="hero">
  <div class="hero-eyebrow">Intelligence Brief ${briefNum ? `#${briefNum}` : ''}</div>
  <div class="hero-title">Your Daily<br>Market Edge</div>
  <div class="hero-meta">
    <span class="meta-tag">📅 ${e(date || '')}</span>
    ${agentVersion ? `<span class="meta-tag">🤖 Agent v${e(agentVersion)}</span>` : ''}
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
  <a href="/api/view">ooppyy-intel-agent.vercel.app</a>
</div>

<div class="toast" id="toast">✅ Link copied!</div>

<script>
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
      navigator.share({ title: 'Ooppyy Intel Brief', text: 'Your daily market intelligence brief', url }).catch(()=>{});
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
