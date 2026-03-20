export default async function handler(req, res) {
  try {
    // Get child pages of main Intel Briefs page
    const r = await fetch(
      `https://api.notion.com/v1/blocks/${process.env.NOTION_PAGE_ID}/children?page_size=100`,
      { headers: { 'Authorization': `Bearer ${process.env.NOTION_TOKEN}`, 'Notion-Version': '2022-06-28' } }
    );
    const data = await r.json();
    if (!r.ok) throw new Error('Failed to fetch Notion page');

    const childPages = data.results.filter(b => b.type === 'child_page');
    if (!childPages.length) {
      return res.setHeader('Content-Type', 'text/html').status(200).send(emptyPage());
    }

    const latest = childPages[childPages.length - 1];

    // Fetch blocks of the latest brief
    const br = await fetch(
      `https://api.notion.com/v1/blocks/${latest.id}/children?page_size=100`,
      { headers: { 'Authorization': `Bearer ${process.env.NOTION_TOKEN}`, 'Notion-Version': '2022-06-28' } }
    );
    const blocks = await br.json();
    if (!br.ok) throw new Error('Failed to fetch brief blocks');

    // Extract JSON from code blocks
    const codeBlocks = blocks.results.filter(b => b.type === 'code');
    let briefData = null;

    if (codeBlocks.length) {
      const rawJson = codeBlocks
        .map(b => b.code.rich_text.map(t => t.plain_text).join(''))
        .join('');
      try { briefData = JSON.parse(rawJson); } catch (e) { /* fall through */ }
    }

    if (!briefData) return res.setHeader('Content-Type', 'text/html').status(200).send(emptyPage());

    const html = renderIosHTML(briefData);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=1800');
    res.status(200).send(html);
  } catch (error) {
    res.status(500).setHeader('Content-Type', 'text/html').send(`
      <html><body style="background:#000;color:#fff;font-family:-apple-system,sans-serif;padding:2rem;display:flex;align-items:center;justify-content:center;height:80vh">
        <div style="text-align:center"><div style="font-size:3rem">⚠️</div><h2 style="margin:1rem 0">Error loading brief</h2>
        <p style="color:#666;font-size:0.9rem">${error.message}</p></div>
      </body></html>`);
  }
}

function esc(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderIosHTML(data) {
  const { date, sections = [], opportunities = [] } = data;

  const sectionsHTML = sections.map((section, si) => {
    const stories = (section.stories || []).map((story, i) => `
      <div class="story-card" onclick="toggleStory(this)" style="--accent:${esc(section.color)}">
        <div class="story-header">
          <div class="story-num">${i + 1}</div>
          <div class="story-headline">${esc(story.headline)}</div>
          <div class="story-chevron">›</div>
        </div>
        <div class="story-body">
          ${story.source_url ? `
          <a href="${esc(story.source_url)}" target="_blank" class="source-pill" onclick="event.stopPropagation()">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            ${esc(story.source_name || 'Source')}
          </a>` : ''}
          <div class="sowhat-block">
            <div class="sowhat-tag">💡 So What</div>
            <div class="sowhat-text">${esc(story.sowhat)}</div>
          </div>
        </div>
      </div>`).join('');

    return `
    <div class="section-card" style="--accent:${esc(section.color)};animation-delay:${si * 0.08}s">
      <div class="section-header">
        <div class="section-icon">${section.emoji}</div>
        <div class="section-label">${esc(section.label)}</div>
        <div class="story-count">${(section.stories || []).length}</div>
      </div>
      <div class="stories">${stories}</div>
    </div>`;
  }).join('');

  const oppsHTML = opportunities.length ? `
    <div class="section-card opps-card" style="--accent:#f59e0b;animation-delay:${sections.length * 0.08}s">
      <div class="section-header">
        <div class="section-icon">🎯</div>
        <div class="section-label">OPPORTUNITIES & THREATS</div>
      </div>
      <div class="opps-list">
        ${opportunities.map(o => `
          <div class="opp-item">
            <div class="opp-dot"></div>
            <div class="opp-text">${esc(o)}</div>
          </div>`).join('')}
      </div>
    </div>` : '';

  const now = new Date().toLocaleDateString('en-SG', {
    timeZone: 'Asia/Singapore', month: 'short', day: 'numeric'
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>Ooppyy Intel — ${esc(now)}</title>
  <style>
    :root {
      --bg: #000000;
      --surface: rgba(28,28,30,0.95);
      --surface2: rgba(44,44,46,0.8);
      --text: #ffffff;
      --text2: rgba(235,235,245,0.6);
      --separator: rgba(84,84,88,0.35);
      --radius: 20px;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
    html { background: var(--bg); }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Helvetica Neue', sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100dvh;
      padding-bottom: env(safe-area-inset-bottom, 20px);
    }
    /* Dynamic Island-style header */
    .top-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 52px 20px 16px;
      position: sticky;
      top: 0;
      z-index: 100;
      background: rgba(0,0,0,0.85);
      backdrop-filter: blur(20px) saturate(180%);
      -webkit-backdrop-filter: blur(20px) saturate(180%);
      border-bottom: 1px solid var(--separator);
    }
    .top-bar-logo {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .top-bar-pill {
      background: rgba(255,255,255,0.1);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 999px;
      padding: 6px 14px 6px 10px;
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 0.8rem;
      font-weight: 700;
      letter-spacing: 0.05em;
      color: var(--text);
    }
    .live-dot {
      width: 7px; height: 7px;
      border-radius: 50%;
      background: #30d158;
      box-shadow: 0 0 6px #30d158;
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0%,100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.6; transform: scale(0.85); }
    }
    .top-bar-date {
      font-size: 0.75rem;
      color: var(--text2);
      font-weight: 500;
    }
    .share-btn {
      background: rgba(255,255,255,0.1);
      border: none;
      color: #0a84ff;
      font-size: 0.8rem;
      font-weight: 600;
      padding: 7px 14px;
      border-radius: 999px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 5px;
    }
    .share-btn:active { opacity: 0.6; }
    /* Hero */
    .hero {
      padding: 24px 20px 20px;
      background: linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0) 100%);
    }
    .hero-label {
      font-size: 0.7rem;
      font-weight: 700;
      letter-spacing: 0.12em;
      color: var(--text2);
      text-transform: uppercase;
      margin-bottom: 6px;
    }
    .hero-title {
      font-size: clamp(1.6rem, 7vw, 2.2rem);
      font-weight: 800;
      letter-spacing: -0.03em;
      line-height: 1.1;
      background: linear-gradient(135deg, #fff 0%, rgba(255,255,255,0.7) 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .hero-sub {
      margin-top: 10px;
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .hero-tag {
      font-size: 0.72rem;
      font-weight: 600;
      color: var(--text2);
      background: rgba(255,255,255,0.07);
      border-radius: 999px;
      padding: 4px 10px;
      border: 1px solid var(--separator);
    }
    /* Feed */
    .feed { padding: 0 16px; }
    /* Section card */
    .section-card {
      background: var(--surface);
      border-radius: var(--radius);
      margin-bottom: 12px;
      overflow: hidden;
      border: 1px solid var(--separator);
      opacity: 0;
      transform: translateY(16px);
      animation: slideUp 0.45s cubic-bezier(0.34,1.56,0.64,1) forwards;
    }
    @keyframes slideUp {
      to { opacity: 1; transform: translateY(0); }
    }
    .section-header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 14px 16px;
      border-bottom: 1px solid var(--separator);
    }
    .section-icon {
      font-size: 1.3rem;
      width: 36px; height: 36px;
      background: rgba(var(--accent-rgb, 255,255,255), 0.12);
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .section-label {
      font-size: 0.78rem;
      font-weight: 800;
      letter-spacing: 0.07em;
      text-transform: uppercase;
      color: var(--accent, #fff);
      flex: 1;
    }
    .story-count {
      font-size: 0.72rem;
      font-weight: 700;
      background: var(--surface2);
      color: var(--text2);
      width: 22px; height: 22px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    /* Story card */
    .stories { padding: 4px 0; }
    .story-card {
      padding: 12px 16px;
      border-bottom: 1px solid var(--separator);
      cursor: pointer;
      transition: background 0.15s;
    }
    .story-card:last-child { border-bottom: none; }
    .story-card:active { background: rgba(255,255,255,0.04); }
    .story-header {
      display: flex;
      align-items: flex-start;
      gap: 10px;
    }
    .story-num {
      min-width: 22px; height: 22px;
      background: var(--accent, #555);
      color: #000;
      font-size: 0.7rem;
      font-weight: 800;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-top: 1px;
      flex-shrink: 0;
    }
    .story-headline {
      font-size: 0.9rem;
      font-weight: 600;
      line-height: 1.45;
      color: var(--text);
      flex: 1;
    }
    .story-chevron {
      font-size: 1.2rem;
      color: var(--text2);
      margin-top: -1px;
      transition: transform 0.25s;
      flex-shrink: 0;
    }
    .story-card.open .story-chevron { transform: rotate(90deg); }
    .story-body {
      max-height: 0;
      overflow: hidden;
      transition: max-height 0.35s cubic-bezier(0.4,0,0.2,1);
      padding-left: 32px;
    }
    .story-card.open .story-body { max-height: 300px; }
    .source-pill {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      background: rgba(10,132,255,0.15);
      color: #0a84ff;
      font-size: 0.75rem;
      font-weight: 600;
      padding: 5px 10px;
      border-radius: 999px;
      text-decoration: none;
      margin: 10px 0 8px;
      border: 1px solid rgba(10,132,255,0.25);
    }
    .source-pill:active { background: rgba(10,132,255,0.25); }
    .sowhat-block {
      background: rgba(245,158,11,0.08);
      border-left: 3px solid #f59e0b;
      border-radius: 0 8px 8px 0;
      padding: 8px 12px;
      margin-bottom: 8px;
    }
    .sowhat-tag {
      font-size: 0.68rem;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #f59e0b;
      margin-bottom: 4px;
    }
    .sowhat-text {
      font-size: 0.83rem;
      line-height: 1.55;
      color: rgba(235,235,245,0.8);
    }
    /* Opportunities */
    .opps-list { padding: 8px 16px 12px; }
    .opp-item {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 8px 0;
      border-bottom: 1px solid var(--separator);
    }
    .opp-item:last-child { border-bottom: none; }
    .opp-dot {
      min-width: 8px; height: 8px;
      border-radius: 50%;
      background: #f59e0b;
      margin-top: 6px;
      flex-shrink: 0;
      box-shadow: 0 0 6px rgba(245,158,11,0.5);
    }
    .opp-text {
      font-size: 0.87rem;
      line-height: 1.5;
      color: rgba(235,235,245,0.85);
    }
    /* Footer */
    .footer {
      padding: 20px;
      text-align: center;
      color: var(--text2);
      font-size: 0.75rem;
    }
    .footer a { color: #0a84ff; text-decoration: none; }
    /* Toast */
    .toast {
      position: fixed;
      bottom: calc(30px + env(safe-area-inset-bottom));
      left: 50%;
      transform: translateX(-50%) translateY(80px);
      background: rgba(44,44,46,0.95);
      color: #fff;
      font-size: 0.85rem;
      font-weight: 600;
      padding: 12px 20px;
      border-radius: 999px;
      backdrop-filter: blur(20px);
      z-index: 999;
      transition: transform 0.3s cubic-bezier(0.34,1.56,0.64,1);
      border: 1px solid var(--separator);
    }
    .toast.show { transform: translateX(-50%) translateY(0); }
  </style>
</head>
<body>
  <div class="top-bar">
    <div class="top-bar-logo">
      <div class="top-bar-pill">
        <div class="live-dot"></div>
        OOPPYY INTEL
      </div>
    </div>
    <div class="top-bar-date">${esc(now)}</div>
    <button class="share-btn" onclick="shareOrCopy()">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
      Share
    </button>
  </div>

  <div class="hero">
    <div class="hero-label">Morning Intelligence Brief</div>
    <div class="hero-title">Your Daily<br>Edge</div>
    <div class="hero-sub">
      <div class="hero-tag">🌍 World</div>
      <div class="hero-tag">📈 Markets</div>
      <div class="hero-tag">💻 Tech</div>
      <div class="hero-tag">👗 Fashion</div>
    </div>
  </div>

  <div class="feed">
    ${sectionsHTML}
    ${oppsHTML}
  </div>

  <div class="footer">
    Generated by Ooppyy · Your AI Chief of Staff<br>
    <a href="https://ooppyy-intel-agent.vercel.app/api/view">ooppyy-intel-agent.vercel.app</a>
  </div>

  <div class="toast" id="toast">✅ Link copied!</div>

  <script>
    function toggleStory(el) {
      el.classList.toggle('open');
    }
    function shareOrCopy() {
      const url = window.location.href;
      if (navigator.share) {
        navigator.share({ title: 'Ooppyy Intel Brief', url }).catch(() => {});
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
    <div><div style="font-size:4rem">🌙</div><h2 style="margin:1rem 0;font-weight:700">No briefs yet</h2><p style="color:#666">Check back tomorrow morning!</p></div>
  </body></html>`;
}
