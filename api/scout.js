const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req, res) {
  try {
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      return res.setHeader('Content-Type', 'text/html; charset=utf-8').status(200).send(emptyPage('Supabase not configured.'));
    }

    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/scout_findings?order=found_at.desc&limit=50&select=*`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
    );

    if (!r.ok) throw new Error(`Supabase error: ${r.status}`);
    const findings = await r.json();

    if (!Array.isArray(findings) || findings.length === 0) {
      return res.setHeader('Content-Type', 'text/html; charset=utf-8').status(200).send(emptyPage());
    }

    const html = renderHTML(findings);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.status(200).send(html);
  } catch (error) {
    res.status(500).setHeader('Content-Type', 'text/html').send(`
      <html><body style="background:#000;color:#fff;font-family:-apple-system,sans-serif;padding:2rem;text-align:center">
        <div style="font-size:3rem">⚠️</div><h2>${error.message}</h2></body></html>`);
  }
}

function e(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const GEO_COLORS = { GCC: '#f59e0b', India: '#22c55e', SEA: '#0ea5e9' };

const SIGNAL_META = {
  launch:       { emoji: '🚀', label: 'Launch' },
  partnership:  { emoji: '🤝', label: 'Partnership' },
  market:       { emoji: '🌏', label: 'Market' },
  retail:       { emoji: '🏪', label: 'Retail' },
  campaign:     { emoji: '🎯', label: 'Campaign' },
  funding:      { emoji: '💰', label: 'Funding' },
  competitor:   { emoji: '⚠️', label: 'Competitor' },
  distribution: { emoji: '📦', label: 'Distribution' },
};

function getSignalMeta(signal_type) {
  const key = (signal_type || '').toLowerCase();
  return SIGNAL_META[key] || { emoji: '📡', label: signal_type || 'Signal' };
}

function scoreBar(score) {
  const s = Math.max(0, Math.min(10, Math.round(Number(score) || 0)));
  const filled = '█'.repeat(s);
  const empty = '░'.repeat(10 - s);
  return `${filled}${empty} ${s}/10`;
}

function formatDate(isoStr) {
  if (!isoStr) return '';
  try {
    return new Date(isoStr).toLocaleDateString('en-SG', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      timeZone: 'Asia/Singapore'
    });
  } catch { return isoStr; }
}

function dayKey(isoStr) {
  if (!isoStr) return 'Unknown';
  try {
    return new Date(isoStr).toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' }); // YYYY-MM-DD
  } catch { return 'Unknown'; }
}

function dayLabel(isoStr) {
  const now = new Date();
  const todaySGT = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
  const key = dayKey(isoStr);
  if (key === todaySGT) return 'Today';
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yestSGT = yesterday.toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
  if (key === yestSGT) return 'Yesterday';
  return formatDate(isoStr);
}

function renderHTML(findings) {
  const totalCount = findings.length;
  const lastUpdated = findings[0]?.found_at
    ? new Date(findings[0].found_at).toLocaleString('en-SG', { timeZone: 'Asia/Singapore', hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })
    : '';

  // Group by day
  const groups = [];
  const groupMap = {};
  for (const f of findings) {
    const key = dayKey(f.found_at);
    if (!groupMap[key]) {
      groupMap[key] = { key, label: dayLabel(f.found_at), items: [] };
      groups.push(groupMap[key]);
    }
    groupMap[key].items.push(f);
  }

  // Geo filter tabs HTML
  const geoTabs = ['all', 'GCC', 'India', 'SEA'];
  const geoTabsHTML = geoTabs.map(g => `
    <button class="tab${g === 'all' ? ' active' : ''}" data-geo="${g}" onclick="setGeo('${g}')">
      ${g === 'all' ? '⚡ All' : g}
    </button>`).join('');

  // Signal filter tabs HTML
  const signalTabs = [
    { key: 'all', emoji: '⚡', label: 'All' },
    { key: 'launch', emoji: '🚀', label: 'Launch' },
    { key: 'partnership', emoji: '🤝', label: 'Partnership' },
    { key: 'market', emoji: '🌏', label: 'Market' },
    { key: 'retail', emoji: '🏪', label: 'Retail' },
    { key: 'campaign', emoji: '🎯', label: 'Campaign' },
    { key: 'funding', emoji: '💰', label: 'Funding' },
    { key: 'competitor', emoji: '⚠️', label: 'Competitor' },
    { key: 'distribution', emoji: '📦', label: 'Distribution' },
  ];
  const signalTabsHTML = signalTabs.map(t => `
    <button class="tab${t.key === 'all' ? ' active' : ''}" data-signal="${t.key}" onclick="setSignal('${t.key}')">
      ${t.emoji} ${t.label}
    </button>`).join('');

  // Cards grouped by date
  const feedHTML = groups.map((group, gi) => {
    const cardsHTML = group.items.map((f, i) => {
      const geoColor = GEO_COLORS[f.geo] || '#888';
      const sig = getSignalMeta(f.signal_type);
      const normalizedSignal = (f.signal_type || '').toLowerCase();
      return `
      <div class="finding-card" data-geo="${e(f.geo || '')}" data-signal="${e(normalizedSignal)}" style="--c:${geoColor};animation-delay:${(gi * 0.05 + i * 0.04).toFixed(2)}s">
        <div class="card-meta-row">
          <span class="sig-emoji">${sig.emoji}</span>
          <span class="brand-name">${e(f.brand)}</span>
          <span class="geo-pill" style="--gc:${geoColor}">${e(f.geo || '')}</span>
          <span class="sig-label">${e(sig.label)}</span>
        </div>
        <div class="card-headline">${e(f.headline)}</div>
        ${f.summary ? `<div class="card-summary">${e(f.summary)}</div>` : ''}
        <div class="card-footer-row">
          <span class="score-bar" title="Signal score">${scoreBar(f.score)}</span>
          ${f.source_url ? `<a href="${e(f.source_url)}" target="_blank" rel="noopener" class="src-btn" onclick="event.stopPropagation()">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            Source
          </a>` : ''}
        </div>
      </div>`;
    }).join('');

    return `
    <div class="day-group" data-day="${e(group.key)}">
      <div class="day-label">${e(group.label)}</div>
      ${cardsHTML}
    </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <title>Ooppyy · Social Scout</title>
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

    /* FILTER TABS */
    .tabs{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;padding-bottom:6px;margin-bottom:4px}
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

    /* FEED */
    .feed{padding:0 12px}

    /* DAY GROUP */
    .day-group{margin-bottom:18px}
    .day-label{font-size:.65rem;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--txt2);margin-bottom:8px;padding-left:2px}
    .day-group.hidden{display:none}

    /* FINDING CARD */
    .finding-card{background:var(--s1);border:1px solid var(--sep);border-left:3px solid var(--c,#888);border-radius:var(--r);margin-bottom:10px;padding:12px 14px;opacity:0;transform:translateY(14px);animation:up .4s cubic-bezier(.34,1.56,.64,1) forwards}
    @keyframes up{to{opacity:1;transform:none}}
    .finding-card.hidden{display:none}

    /* CARD INTERNALS */
    .card-meta-row{display:flex;align-items:center;gap:7px;margin-bottom:7px;flex-wrap:wrap}
    .sig-emoji{font-size:1rem;line-height:1;flex-shrink:0}
    .brand-name{font-size:.78rem;font-weight:800;color:var(--txt);letter-spacing:.01em}
    .geo-pill{font-size:.65rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;background:color-mix(in srgb,var(--gc,#888) 15%,transparent);color:var(--gc,#888);border:1px solid color-mix(in srgb,var(--gc,#888) 30%,transparent);border-radius:999px;padding:2px 8px;flex-shrink:0}
    .sig-label{font-size:.65rem;font-weight:600;color:var(--txt2);background:var(--s2);border:1px solid var(--sep);border-radius:999px;padding:2px 8px;flex-shrink:0}
    .card-headline{font-size:.92rem;font-weight:700;line-height:1.4;color:var(--txt);margin-bottom:6px}
    .card-summary{font-size:.8rem;line-height:1.5;color:var(--txt2);margin-bottom:8px;border-left:2px solid color-mix(in srgb,var(--c,#888) 40%,transparent);padding-left:9px}
    .card-footer-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:4px}
    .score-bar{font-size:.7rem;font-family:'SF Mono',Menlo,monospace;color:var(--txt2);letter-spacing:.02em;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:clip}

    /* SOURCE BUTTON — matches view.js exactly */
    .src-btn{display:inline-flex;align-items:center;gap:5px;background:rgba(10,132,255,.12);color:#0a84ff;font-size:.73rem;font-weight:600;padding:5px 10px;border-radius:999px;text-decoration:none;border:1px solid rgba(10,132,255,.2);flex-shrink:0}
    .src-btn:active{background:rgba(10,132,255,.25)}

    /* FOOTER */
    .footer{padding:16px;text-align:center;color:var(--txt2);font-size:.72rem;line-height:1.7}
    .footer a{color:#0a84ff;text-decoration:none}

    /* EMPTY STATE */
    .empty{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:40dvh;text-align:center;padding:2rem}
    .empty-icon{font-size:3.5rem;margin-bottom:1rem}
    .empty-title{font-size:1.1rem;font-weight:700;color:var(--txt);margin-bottom:.4rem}
    .empty-sub{font-size:.85rem;color:var(--txt2)}

    /* TOAST */
    .toast{position:fixed;bottom:calc(28px + env(safe-area-inset-bottom));left:50%;transform:translateX(-50%) translateY(80px);background:var(--s1);color:var(--txt);font-size:.83rem;font-weight:600;padding:11px 20px;border-radius:999px;backdrop-filter:blur(20px);z-index:999;transition:transform .3s cubic-bezier(.34,1.56,.64,1);border:1px solid var(--sep)}
    .toast.show{transform:translateX(-50%) translateY(0)}
  </style>
</head>
<body>

<div class="topbar">
  <div class="topbar-row">
    <div class="agent-pill"><div class="live"></div>Ooppyy · Social Scout</div>
    <div class="topbar-actions">
      <button class="theme-btn" id="theme-btn" onclick="toggleTheme()">🌙</button>
      <button class="share-btn" onclick="share()">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
        Share
      </button>
    </div>
  </div>
  <div class="tabs" id="geo-tabs">${geoTabsHTML}</div>
  <div class="tabs" id="signal-tabs">${signalTabsHTML}</div>
</div>

<div class="hero">
  <div class="hero-eyebrow">Social Scout</div>
  <div class="hero-title">Brand &amp; Market<br>Intelligence</div>
  <div class="hero-meta">
    <span class="meta-tag">📡 ${totalCount} findings</span>
    ${lastUpdated ? `<span class="meta-tag">🕐 ${e(lastUpdated)}</span>` : ''}
    <span class="meta-tag">🌏 GCC · India · SEA</span>
  </div>
</div>

<div class="feed" id="feed">
  ${feedHTML}
</div>

<div class="footer">
  Ooppyy · Social Scout Agent<br>
  <a href="/api/view">← Daily Brief</a> · <a href="/api/scout">Social Scout</a>
</div>

<div class="toast" id="toast">✅ Link copied!</div>

<script>
  // Theme restore
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

  // Active filter state
  let activeGeo = 'all';
  let activeSignal = 'all';

  function setGeo(key) {
    activeGeo = key;
    document.querySelectorAll('#geo-tabs .tab').forEach(t => t.classList.toggle('active', t.dataset.geo === key));
    applyFilters();
  }

  function setSignal(key) {
    activeSignal = key;
    document.querySelectorAll('#signal-tabs .tab').forEach(t => t.classList.toggle('active', t.dataset.signal === key));
    applyFilters();
  }

  function applyFilters() {
    const cards = document.querySelectorAll('.finding-card');
    cards.forEach(card => {
      const geoMatch = activeGeo === 'all' || card.dataset.geo === activeGeo;
      const sigMatch = activeSignal === 'all' || card.dataset.signal === activeSignal;
      card.classList.toggle('hidden', !(geoMatch && sigMatch));
    });

    // Hide day groups that have no visible cards
    document.querySelectorAll('.day-group').forEach(group => {
      const visible = group.querySelectorAll('.finding-card:not(.hidden)').length;
      group.classList.toggle('hidden', visible === 0);
    });
  }

  function share() {
    const url = window.location.href;
    if (navigator.share) {
      navigator.share({ title: 'Ooppyy Social Scout', text: 'Brand & market intelligence', url }).catch(()=>{});
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

function emptyPage(reason) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <title>Ooppyy · Social Scout</title>
  <style>
    :root{--bg:#000;--txt:#fff;--txt2:rgba(235,235,245,.55)}
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','Helvetica Neue',sans-serif;background:var(--bg);color:var(--txt);display:flex;align-items:center;justify-content:center;min-height:100dvh;text-align:center;padding:2rem}
    .footer{position:fixed;bottom:24px;left:0;right:0;text-align:center;font-size:.72rem;color:var(--txt2)}
    .footer a{color:#0a84ff;text-decoration:none}
  </style>
</head>
<body>
  <div>
    <div style="font-size:4rem">📡</div>
    <h2 style="margin:1rem 0;font-weight:700">No findings yet</h2>
    <p style="color:rgba(235,235,245,.55);font-size:.9rem">${reason ? e(reason) : 'The Scout agent hasn\'t reported in yet.'}</p>
  </div>
  <div class="footer"><a href="/api/view">← Daily Brief</a></div>
</body>
</html>`;
}
