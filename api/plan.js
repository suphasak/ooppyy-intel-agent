export default async function handler(req, res) {
  const NOTION_TOKEN   = process.env.NOTION_TOKEN;
  const TASKS_DB_ID    = process.env.NOTION_TASKS_DB_ID;
  const PROJECTS_DB_ID = process.env.NOTION_PROJECTS_DB_ID;
  const GOALS_DB_ID    = process.env.NOTION_GOALS_DB_ID;

  try {
    // ── Missing DB config → setup prompt ────────────────────────────────────
    if (!TASKS_DB_ID || !PROJECTS_DB_ID || !GOALS_DB_ID) {
      return res.setHeader('Content-Type', 'text/html; charset=utf-8').status(200).send(setupPromptPage());
    }

    const notionHeaders = {
      'Authorization': `Bearer ${NOTION_TOKEN}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28',
    };

    // ── Fetch all three databases in parallel ────────────────────────────────
    const [goals, projects, tasks] = await Promise.all([
      queryDb(notionHeaders, GOALS_DB_ID),
      queryDb(notionHeaders, PROJECTS_DB_ID),
      queryDb(notionHeaders, TASKS_DB_ID),
    ]);

    const html = renderHTML({ goals, projects, tasks });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=60');
    return res.status(200).send(html);

  } catch (error) {
    return res.setHeader('Content-Type', 'text/html').status(500).send(`
      <html><body style="background:#000;color:#fff;font-family:-apple-system,sans-serif;padding:2rem;text-align:center">
        <div style="font-size:3rem">⚠️</div><h2>${error.message}</h2></body></html>`);
  }
}

// ── Notion helpers ─────────────────────────────────────────────────────────────

async function queryDb(notionHeaders, dbId) {
  const r = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
    method: 'POST',
    headers: notionHeaders,
    body: JSON.stringify({ page_size: 100 }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`Notion query error: ${JSON.stringify(data)}`);
  return data.results || [];
}

// ── Prop extractors ─────────────────────────────────────────────────────────────

function propTitle(page) {
  const t = page.properties?.Name?.title;
  return t && t.length ? t[0].plain_text : '(untitled)';
}
function propStatus(page)   { return page.properties?.Status?.select?.name || ''; }
function propDate(page)     { return page.properties?.['Due Date']?.date?.start || ''; }
function propPriority(page) { return page.properties?.Priority?.select?.name || ''; }
function propQuarter(page)  { return page.properties?.Quarter?.select?.name || ''; }
function propGoal(page)     { return page.properties?.Goal?.rich_text?.[0]?.plain_text || ''; }
function propProject(page)  { return page.properties?.Project?.rich_text?.[0]?.plain_text || ''; }
function propNotes(page)    { return page.properties?.Notes?.rich_text?.[0]?.plain_text || ''; }

// ── HTML escape ─────────────────────────────────────────────────────────────────

function e(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Status colours ──────────────────────────────────────────────────────────────

const STATUS_COLOR = {
  'Active':      '#0ea5e9',
  'Todo':        '#0ea5e9',
  'Planning':    '#0ea5e9',
  'In Progress': '#f59e0b',
  'On Hold':     '#f59e0b',
  'Paused':      '#94a3b8',
  'Done':        '#22c55e',
  'Completed':   '#22c55e',
  'Blocked':     '#ef4444',
};

const PRIORITY_COLOR = {
  'High':   '#ef4444',
  'Medium': '#f59e0b',
  'Low':    '#94a3b8',
};

function statusPill(status) {
  const color = STATUS_COLOR[status] || '#94a3b8';
  return `<span class="pill" style="background:${color}20;color:${color};border-color:${color}40">${e(status || '—')}</span>`;
}

function priorityBadge(priority) {
  if (!priority) return '';
  const color = PRIORITY_COLOR[priority] || '#94a3b8';
  return `<span class="badge" style="color:${color}">${e(priority)}</span>`;
}

// ── Render ─────────────────────────────────────────────────────────────────────

function renderHTML({ goals, projects, tasks }) {

  const totalOpen = tasks.filter(t => propStatus(t) !== 'Done').length;
  const totalActive = projects.filter(p => propStatus(p) !== 'Completed').length;
  const totalGoals = goals.filter(g => propStatus(g) === 'Active').length;

  // ── Goals section ──────────────────────────────────────────────────────────
  const goalsHTML = goals.length
    ? goals.map((g, i) => `
      <div class="item-card" onclick="toggle(this)" style="--c:${STATUS_COLOR[propStatus(g)] || '#0ea5e9'};animation-delay:${i * 0.05}s">
        <div class="item-row">
          <div class="item-num" style="background:${STATUS_COLOR[propStatus(g)] || '#0ea5e9'}">${i + 1}</div>
          <div class="item-main">
            <div class="item-title">${e(propTitle(g))}</div>
            <div class="item-meta">${propQuarter(g) ? `<span class="meta-tag">${e(propQuarter(g))}</span>` : ''}${statusPill(propStatus(g))}${priorityBadge(propPriority(g))}</div>
          </div>
          <div class="chevron">›</div>
        </div>
      </div>`).join('')
    : `<div class="empty-state">🎯 No goals yet<br><span>Add one via Telegram: <code>add goal: [name] q[1-4]</code></span></div>`;

  // ── Projects section ────────────────────────────────────────────────────────
  const projectsHTML = projects.length
    ? projects.map((p, i) => `
      <div class="item-card" onclick="toggle(this)" style="--c:${STATUS_COLOR[propStatus(p)] || '#0ea5e9'};animation-delay:${i * 0.05}s">
        <div class="item-row">
          <div class="item-num" style="background:${STATUS_COLOR[propStatus(p)] || '#0ea5e9'}">${i + 1}</div>
          <div class="item-main">
            <div class="item-title">${e(propTitle(p))}</div>
            <div class="item-meta">
              ${statusPill(propStatus(p))}
              ${priorityBadge(propPriority(p))}
              ${propDate(p) ? `<span class="meta-tag">📅 ${e(propDate(p))}</span>` : ''}
            </div>
          </div>
          <div class="chevron">›</div>
        </div>
        <div class="item-expand">
          ${propGoal(p) ? `<div class="expand-row"><span class="expand-label">Goal</span>${e(propGoal(p))}</div>` : ''}
        </div>
      </div>`).join('')
    : `<div class="empty-state">📁 No projects yet<br><span>Add one via Telegram: <code>add project: [name] due [date]</code></span></div>`;

  // ── Tasks section — grouped by status ──────────────────────────────────────
  const taskOrder = ['In Progress', 'Blocked', 'Todo', 'Done'];
  const grouped = {};
  for (const t of tasks) {
    const s = propStatus(t) || 'Todo';
    if (!grouped[s]) grouped[s] = [];
    grouped[s].push(t);
  }

  const tasksHTML = tasks.length
    ? taskOrder.flatMap(status => {
        const items = grouped[status] || [];
        if (!items.length) return [];
        const icon = status === 'In Progress' ? '🔵' : status === 'Blocked' ? '🔴' : status === 'Done' ? '🟢' : '⚪';
        const color = STATUS_COLOR[status] || '#94a3b8';
        return [`
          <div class="task-group">
            <div class="task-group-head" style="color:${color}">${icon} ${status} <span class="group-count">${items.length}</span></div>
            ${items.map((t, i) => `
              <div class="item-card task-card" onclick="toggle(this)" style="--c:${color};animation-delay:${i * 0.04}s">
                <div class="item-row">
                  <div class="task-dot" style="background:${color}"></div>
                  <div class="item-main">
                    <div class="item-title ${status === 'Done' ? 'done-text' : ''}">${e(propTitle(t))}</div>
                    <div class="item-meta">
                      ${priorityBadge(propPriority(t))}
                      ${propDate(t) ? `<span class="meta-tag">📅 ${e(propDate(t))}</span>` : ''}
                      ${propProject(t) ? `<span class="meta-tag">📁 ${e(propProject(t))}</span>` : ''}
                    </div>
                  </div>
                  <div class="chevron">›</div>
                </div>
                <div class="item-expand">
                  ${propNotes(t) ? `<div class="expand-row"><span class="expand-label">Notes</span>${e(propNotes(t))}</div>` : ''}
                </div>
              </div>`).join('')}
          </div>`];
      }).join('')
    : `<div class="empty-state">✅ No tasks yet<br><span>Add one via Telegram: <code>add task: [name] by [date]</code></span></div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <title>Ooppyy · Planning HQ</title>
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

    /* FILTER TABS */
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

    /* SECTIONS */
    .feed{padding:0 12px}
    .section{margin-bottom:16px}
    .section.hidden{display:none}
    .section-head{display:flex;align-items:center;gap:10px;padding:0 2px 8px}
    .section-icon{font-size:1.2rem;width:34px;height:34px;border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
    .section-title{font-size:.73rem;font-weight:800;letter-spacing:.06em;text-transform:uppercase;flex:1}
    .section-badge{font-size:.68rem;font-weight:700;color:var(--txt2);background:var(--s2);padding:2px 8px;border-radius:999px;border:1px solid var(--sep)}

    /* CARDS */
    .item-card{background:var(--s1);border:1px solid var(--sep);border-left:3px solid var(--c,#fff);border-radius:var(--r);margin-bottom:7px;overflow:hidden;opacity:0;transform:translateY(14px);animation:up .4s cubic-bezier(.34,1.56,.64,1) forwards;cursor:pointer;transition:background .15s}
    .item-card:active{background:rgba(255,255,255,.04)}
    html.light .item-card:active{background:rgba(0,0,0,.04)}
    @keyframes up{to{opacity:1;transform:none}}
    .item-row{display:flex;align-items:flex-start;gap:9px;padding:11px 14px}
    .item-num{min-width:20px;height:20px;border-radius:50%;color:#fff;font-size:.68rem;font-weight:800;display:flex;align-items:center;justify-content:center;margin-top:2px;flex-shrink:0}
    html.light .item-num{color:#000;filter:brightness(1.2)}
    .task-dot{min-width:10px;height:10px;border-radius:50%;margin-top:5px;flex-shrink:0}
    .item-main{flex:1;min-width:0}
    .item-title{font-size:.88rem;font-weight:600;line-height:1.45;color:var(--txt);margin-bottom:4px}
    .done-text{opacity:.45;text-decoration:line-through}
    .item-meta{display:flex;gap:5px;flex-wrap:wrap;align-items:center}
    .chevron{color:var(--txt2);font-size:1.1rem;transition:transform .25s;flex-shrink:0;align-self:flex-start;margin-top:2px}
    .item-card.open .chevron{transform:rotate(90deg)}

    /* EXPAND */
    .item-expand{max-height:0;overflow:hidden;transition:max-height .35s ease;padding-left:29px}
    .item-card.open .item-expand{max-height:200px}
    .task-card .item-expand{padding-left:19px}
    .expand-row{font-size:.8rem;line-height:1.55;color:var(--txt2);padding:0 14px 10px;border-left:2px solid rgba(245,158,11,.4);margin-left:2px}
    .expand-label{font-size:.65rem;font-weight:800;letter-spacing:.07em;text-transform:uppercase;color:#f59e0b;display:block;margin-bottom:2px}

    /* PILLS & BADGES */
    .pill{font-size:.65rem;font-weight:700;padding:2px 8px;border-radius:999px;border:1px solid;letter-spacing:.02em}
    .badge{font-size:.65rem;font-weight:700;letter-spacing:.04em}

    /* TASK GROUPS */
    .task-group{margin-bottom:10px}
    .task-group-head{font-size:.7rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase;padding:4px 2px 6px;display:flex;align-items:center;gap:6px}
    .group-count{font-size:.65rem;color:var(--txt2);background:var(--s2);padding:1px 7px;border-radius:999px;border:1px solid var(--sep);font-weight:700}

    /* EMPTY STATE */
    .empty-state{text-align:center;padding:28px 16px;color:var(--txt2);font-size:.85rem;line-height:1.7;background:var(--s1);border-radius:var(--r);border:1px solid var(--sep);margin-bottom:7px}
    .empty-state code{font-family:ui-monospace,monospace;font-size:.78rem;background:var(--tab-bg);padding:1px 6px;border-radius:5px;border:1px solid var(--sep);color:var(--txt)}

    /* FOOTER */
    .footer{padding:16px;text-align:center;color:var(--txt2);font-size:.72rem;line-height:1.7}
    .footer a{color:#0a84ff;text-decoration:none}
  </style>
</head>
<body>

<div class="topbar">
  <div class="topbar-row">
    <div class="agent-pill"><div class="live"></div>Ooppyy · Planning HQ</div>
    <div class="topbar-actions">
      <button class="theme-btn" id="theme-btn" onclick="toggleTheme()">🌙</button>
    </div>
  </div>
  <div class="tabs">
    <button class="tab active" data-tab="all" onclick="setTab('all')">⚡ All</button>
    <button class="tab" data-tab="goals" onclick="setTab('goals')">🎯 Goals</button>
    <button class="tab" data-tab="projects" onclick="setTab('projects')">📁 Projects</button>
    <button class="tab" data-tab="tasks" onclick="setTab('tasks')">✅ Tasks</button>
  </div>
</div>

<div class="hero">
  <div class="hero-eyebrow">Agent #0 · Planning</div>
  <div class="hero-title">Planning HQ</div>
  <div class="hero-meta">
    <span class="meta-tag">🎯 ${totalGoals} active goals</span>
    <span class="meta-tag">📁 ${totalActive} active projects</span>
    <span class="meta-tag">✅ ${totalOpen} open tasks</span>
  </div>
</div>

<div class="feed" id="feed">

  <div class="section" data-section="goals">
    <div class="section-head">
      <div class="section-icon" style="background:#0ea5e920">🎯</div>
      <span class="section-title" style="color:#0ea5e9">Goals</span>
      <span class="section-badge">${goals.length}</span>
    </div>
    ${goalsHTML}
  </div>

  <div class="section" data-section="projects">
    <div class="section-head">
      <div class="section-icon" style="background:#a855f720">📁</div>
      <span class="section-title" style="color:#a855f7">Projects</span>
      <span class="section-badge">${projects.length}</span>
    </div>
    ${projectsHTML}
  </div>

  <div class="section" data-section="tasks">
    <div class="section-head">
      <div class="section-icon" style="background:#22c55e20">✅</div>
      <span class="section-title" style="color:#22c55e">Tasks</span>
      <span class="section-badge">${tasks.length}</span>
    </div>
    ${tasksHTML}
  </div>

</div>

<div class="footer">
  Ooppyy · Planning Agent<br>
  <a href="/api/view">Daily Brief</a> · <a href="/api/scout">Social Scout</a> · <a href="/api/plan">Planning HQ</a>
</div>

<script>
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
</script>
</body>
</html>`;
}

function setupPromptPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <title>Ooppyy · Planning Setup</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','Helvetica Neue',sans-serif;background:#000;color:#fff;min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:24px}
    .card{background:rgba(28,28,30,.98);border:1px solid rgba(84,84,88,.3);border-radius:20px;padding:32px 24px;max-width:440px;width:100%;text-align:center}
    .icon{font-size:3.5rem;margin-bottom:16px}
    h2{font-size:1.4rem;font-weight:800;letter-spacing:-.02em;margin-bottom:8px}
    p{font-size:.88rem;color:rgba(235,235,245,.55);line-height:1.6;margin-bottom:20px}
    .step{background:rgba(255,255,255,.05);border:1px solid rgba(84,84,88,.3);border-radius:12px;padding:14px 16px;text-align:left;margin-bottom:10px}
    .step-num{font-size:.65rem;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#0ea5e9;margin-bottom:4px}
    .step-text{font-size:.84rem;color:#fff;line-height:1.5}
    code{font-family:ui-monospace,monospace;font-size:.78rem;background:rgba(255,255,255,.08);padding:2px 7px;border-radius:6px;border:1px solid rgba(84,84,88,.3)}
    a{color:#0a84ff;text-decoration:none;font-weight:600}
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">🧠</div>
    <h2>Planning HQ not configured</h2>
    <p>Run the one-time setup to create your Notion databases and register the Telegram webhook.</p>
    <div class="step">
      <div class="step-num">Step 1</div>
      <div class="step-text">Visit <a href="/api/plan-setup">/api/plan-setup</a> to initialise Planning HQ in Notion.</div>
    </div>
    <div class="step">
      <div class="step-num">Step 2</div>
      <div class="step-text">Copy the <code>NOTION_TASKS_DB_ID</code>, <code>NOTION_PROJECTS_DB_ID</code>, and <code>NOTION_GOALS_DB_ID</code> values into your Vercel environment variables.</div>
    </div>
    <div class="step">
      <div class="step-num">Step 3</div>
      <div class="step-text">Redeploy, then come back here. You're good to go.</div>
    </div>
  </div>
</body>
</html>`;
}
