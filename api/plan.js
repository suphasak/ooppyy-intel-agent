function parseCookies(str) {
  const out = {};
  for (const part of (str || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k) out[decodeURIComponent(k.trim())] = decodeURIComponent(v.join('=').trim());
  }
  return out;
}

async function readBody(req) {
  return new Promise(resolve => {
    let s = '';
    req.on('data', c => { s += c; });
    req.on('end', () => resolve(Object.fromEntries(new URLSearchParams(s))));
  });
}

function loginPage(error = '') {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <title>Ooppyy · Planning HQ</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display',sans-serif;background:#000;color:#fff;min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:24px}
    .card{background:rgba(28,28,30,.98);border:1px solid rgba(84,84,88,.3);border-radius:20px;padding:36px 28px;max-width:360px;width:100%;text-align:center}
    .icon{font-size:2.8rem;margin-bottom:14px}
    h2{font-size:1.25rem;font-weight:800;letter-spacing:-.02em;margin-bottom:6px}
    p{font-size:.82rem;color:rgba(235,235,245,.45);margin-bottom:24px;line-height:1.5}
    input{width:100%;background:rgba(255,255,255,.07);border:1px solid rgba(84,84,88,.4);border-radius:12px;color:#fff;font-size:1rem;padding:14px 16px;outline:none;margin-bottom:10px;-webkit-appearance:none;letter-spacing:.1em}
    input:focus{border-color:#0a84ff;outline:none}
    button{width:100%;background:#0a84ff;border:none;border-radius:12px;color:#fff;font-size:.95rem;font-weight:700;padding:14px;cursor:pointer;transition:opacity .15s}
    button:active{opacity:.7}
    .err{color:#ff453a;font-size:.8rem;margin-bottom:10px;padding:8px 12px;background:rgba(255,69,58,.1);border:1px solid rgba(255,69,58,.2);border-radius:8px}
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">🧠</div>
    <h2>Ooppyy OS</h2>
    <p>Planning HQ · Private</p>
    ${error ? `<div class="err">${error}</div>` : ''}
    <form method="POST" action="/api/plan">
      <input type="password" name="password" placeholder="Password" autofocus autocomplete="current-password">
      <button type="submit">Enter</button>
    </form>
  </div>
</body>
</html>`;
}

export default async function handler(req, res) {
  const NOTION_TOKEN      = process.env.NOTION_TOKEN;
  const TASKS_DB_ID       = process.env.NOTION_TASKS_DB_ID;
  const PROJECTS_DB_ID    = process.env.NOTION_PROJECTS_DB_ID;
  const GOALS_DB_ID       = process.env.NOTION_GOALS_DB_ID;
  const MISSION_PAGE_ID   = process.env.NOTION_MISSION_PAGE_ID;
  const PLAN_SECRET       = process.env.PLAN_SECRET;

  // ── Auth gate ──────────────────────────────────────────────────────────────
  if (PLAN_SECRET) {
    const cookies = parseCookies(req.headers.cookie);

    if (req.method === 'POST') {
      const body = await readBody(req);
      if (body.password.trim() === PLAN_SECRET.trim()) {
        res.setHeader('Set-Cookie', `ooppyy_plan=${encodeURIComponent(PLAN_SECRET)}; Path=/api/plan; HttpOnly; Max-Age=${60 * 60 * 24 * 30}; SameSite=Lax`);
        res.setHeader('Location', '/api/plan');
        return res.status(302).end();
      }
      return res.setHeader('Content-Type', 'text/html; charset=utf-8').status(200).send(loginPage('Wrong password.'));
    }

    if (cookies.ooppyy_plan !== PLAN_SECRET) {
      return res.setHeader('Content-Type', 'text/html; charset=utf-8').status(200).send(loginPage());
    }
  }

  try {
    if (!TASKS_DB_ID || !PROJECTS_DB_ID || !GOALS_DB_ID) {
      return res.setHeader('Content-Type', 'text/html; charset=utf-8').status(200).send(setupPromptPage());
    }

    const notionHeaders = {
      'Authorization': `Bearer ${NOTION_TOKEN}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28',
    };

    // Fetch mission page + all three DBs in parallel
    const [missionPage, goals, projects, tasks] = await Promise.all([
      MISSION_PAGE_ID
        ? fetch(`https://api.notion.com/v1/pages/${MISSION_PAGE_ID}`, { headers: notionHeaders })
            .then(r => r.ok ? r.json() : null)
            .catch(() => null)
        : Promise.resolve(null),
      queryDb(notionHeaders, GOALS_DB_ID),
      queryDb(notionHeaders, PROJECTS_DB_ID),
      queryDb(notionHeaders, TASKS_DB_ID),
    ]);

    const missionText = missionPage ? propTitle(missionPage) : '';

    const html = renderHTML({ missionText, goals, projects, tasks });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(html);

  } catch (error) {
    return res.setHeader('Content-Type', 'text/html').status(500).send(`
      <html><body style="background:#000;color:#fff;font-family:-apple-system,sans-serif;padding:2rem;text-align:center">
        <div style="font-size:3rem">⚠️</div><h2>${error.message}</h2></body></html>`);
  }
}

// ── Notion helpers ──────────────────────────────────────────────────────────────

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
  if (t && t.length) return t[0].plain_text;
  // fallback: some pages use 'title' as the title property key
  const keys = Object.keys(page.properties || {});
  for (const k of keys) {
    const prop = page.properties[k];
    if (prop.type === 'title' && prop.title?.length) return prop.title[0].plain_text;
  }
  return '(untitled)';
}
function propStatus(page)   { return page.properties?.Status?.select?.name || ''; }
function propDate(page)     { return page.properties?.['Due Date']?.date?.start || ''; }
function propPriority(page) { return page.properties?.Priority?.select?.name || ''; }
function propQuarter(page)  { return page.properties?.Quarter?.select?.name || ''; }
function propGoal(page)     { return page.properties?.Goal?.rich_text?.[0]?.plain_text || ''; }
function propProject(page)  { return page.properties?.Project?.rich_text?.[0]?.plain_text || ''; }
function propCode(page)     { return page.properties?.Code?.rich_text?.[0]?.plain_text || ''; }
function propNotes(page)    { return page.properties?.Notes?.rich_text?.[0]?.plain_text || ''; }

// ── HTML escape ──────────────────────────────────────────────────────────────────

function e(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Status colours ───────────────────────────────────────────────────────────────

const STATUS_COLOR = {
  'Active':      '#2080c8',
  'Todo':        '#787870',
  'Planning':    '#4890b8',
  'In Progress': '#c87820',
  'On Hold':     '#806840',
  'Paused':      '#8060a0',
  'Done':        '#20a040',
  'Completed':   '#1a9060',
  'Blocked':     '#c82050',
};

function statusPill(status) {
  const color = STATUS_COLOR[status] || '#787870';
  return `<span class="type-badge" style="background:${color};color:#f0f0e0">${e(status || '—')}</span>`;
}

function codePill(code) {
  if (!code) return '';
  return `<span class="code-pill">${e(code)}</span>`;
}

function fmtDate(d) {
  if (!d) return '';
  // e.g. "2026-03-15" → "Mar 15"
  try {
    const dt = new Date(d + 'T00:00:00');
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch { return d; }
}

// ── Deadline helper ──────────────────────────────────────────────────────────────

function deadlineBanner() {
  const today    = new Date();
  const deadline = new Date('2026-03-31');
  const daysLeft = Math.ceil((deadline - today) / (1000 * 60 * 60 * 24));
  if (daysLeft < 0) {
    return `<span class="deadline-chip" style="background:#c8282020;color:#c82820;border-color:#c82820">DEADLINE PASSED</span>`;
  }
  const color = daysLeft <= 7 ? '#c82820' : daysLeft <= 14 ? '#c8a820' : '#20a040';
  return `<span class="deadline-chip" style="background:${color}20;color:${color};border-color:${color}">${daysLeft}D LEFT</span>`;
}

// ── Main render ──────────────────────────────────────────────────────────────────

function renderHTML({ missionText, goals, projects, tasks }) {

  // ── Build hierarchy ──────────────────────────────────────────────────────────
  const goalsByName = new Map();
  for (const g of goals) goalsByName.set(propTitle(g), g);

  const projectsByGoal = new Map(); // goalName → [projects]
  const unlinkedProjects = [];
  for (const p of projects) {
    const gName = propGoal(p);
    if (gName && goalsByName.has(gName)) {
      if (!projectsByGoal.has(gName)) projectsByGoal.set(gName, []);
      projectsByGoal.get(gName).push(p);
    } else {
      unlinkedProjects.push(p);
    }
  }

  const tasksByProject = new Map(); // projectTitle → [tasks]
  const unlinkedTasks = [];
  for (const t of tasks) {
    const pName = propProject(t);
    if (pName) {
      if (!tasksByProject.has(pName)) tasksByProject.set(pName, []);
      tasksByProject.get(pName).push(t);
    } else {
      unlinkedTasks.push(t);
    }
  }

  // ── Stats ────────────────────────────────────────────────────────────────────
  const activeGoals = goals.filter(g => propStatus(g) === 'Active').length;
  const openTasks   = tasks.filter(t => propStatus(t) !== 'Done' && propStatus(t) !== 'Completed').length;

  // ── OS View: goals grid ──────────────────────────────────────────────────────
  function renderTaskItem(t, idx) {
    const status = propStatus(t);
    const color  = STATUS_COLOR[status] || '#94a3b8';
    const code   = propCode(t);
    const due    = propDate(t);
    const isDone = status === 'Done' || status === 'Completed';
    return `
      <div class="task-item" data-id="${t.id}">
        <button class="check-btn${isDone ? ' done' : ''}" style="border-color:${color}" onclick="event.stopPropagation();markDone('${t.id}',this)">${isDone ? '✓' : ''}</button>
        <span class="task-body">
          ${code ? `<span class="code-pill">${e(code)}</span> ` : ''}<span class="task-name ${isDone ? 'done-text' : ''}">${e(propTitle(t))}</span>
        </span>
        <span class="task-right">
          ${due ? `<span class="task-due">${e(fmtDate(due))}</span>` : ''}
          <span class="type-badge clickable pill-btn" style="background:${color};color:#f0f0d8" onclick="event.stopPropagation();cycleStatus('${t.id}','${status}','task',this)">${e(status)}</span>
        </span>
      </div>`;
  }

  function renderProjectRow(p, pIdx) {
    const status   = propStatus(p);
    const color    = STATUS_COLOR[status] || '#94a3b8';
    const code     = propCode(p);
    const due      = propDate(p);
    const pTitle   = propTitle(p);
    const pTasks   = tasksByProject.get(pTitle) || [];
    const safeId   = `proj-${pIdx}-${Math.random().toString(36).slice(2,7)}`;

    const safeProjectName = e(pTitle).replace(/'/g, '&#39;');
    const addTaskBtn = `<button class="add-inline" onclick="event.stopPropagation();showAddSheet('task',{projectName:'${safeProjectName}'})">+ ADD TASK</button>`;
    const tasksInner = (pTasks.length
      ? pTasks.map((t, i) => renderTaskItem(t, i)).join('')
      : `<div class="task-empty">No tasks yet — tap + ADD TASK below</div>`) + addTaskBtn;

    const pColor = STATUS_COLOR[status] || '#787870';
    return `
      <div class="proj-row" onclick="toggleProj('${safeId}', event)">
        <div class="proj-row-main">
          <span class="proj-cursor">▶</span>
          ${code ? `<span class="code-pill">${e(code)}</span>` : ''}
          <span class="proj-name">${e(pTitle)}</span>
          <span class="proj-spacer"></span>
          <span class="type-badge clickable pill-btn" style="background:${pColor};color:#f0f0d8" onclick="event.stopPropagation();cycleStatus('${p.id}','${status}','project',this)">${e(status || '—')}</span>
          ${due ? `<span class="proj-due">${e(fmtDate(due))}</span>` : ''}
          <span class="proj-chevron" id="${safeId}-ch">›</span>
        </div>
        <div class="proj-tasks" id="${safeId}">
          ${tasksInner}
        </div>
      </div>`;
  }

  function renderGoalCard(g, gIdx) {
    const status     = propStatus(g);
    const color      = STATUS_COLOR[status] || '#2080c8';
    const code       = propCode(g);
    const quarter    = propQuarter(g);
    const gTitle     = propTitle(g);
    const linked     = projectsByGoal.get(gTitle) || [];
    const cardId     = `goal-${gIdx}`;
    const doneCount  = linked.filter(p => propStatus(p) === 'Completed' || propStatus(p) === 'Done').length;
    const totalCount = linked.length;
    const hpPct      = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;
    const hpColor    = hpPct >= 70 ? '#20a040' : hpPct >= 35 ? '#c8a820' : '#c82820';

    const projectsInner = linked.length
      ? linked.map((p, pi) => renderProjectRow(p, gIdx * 100 + pi)).join('')
      : `<div class="goal-empty-projects">No projects linked<br><span class="link-hint">Telegram: <code>link project: P1 to goal: ${e(gTitle)}</code></span></div>`;

    return `
      <div class="gb-window goal-card" style="--gc:${color};animation-delay:${gIdx * 0.07}s" onclick="toggleGoal('${cardId}', event)">
        <div class="goal-banner" style="background:${color}">
          <div class="goal-banner-left">
            ${code ? `<span class="code-pill" style="background:rgba(0,0,0,.3);border-color:rgba(255,255,255,.2);color:#f0f0d8">${e(code)}</span>` : `<span class="code-pill" style="background:rgba(0,0,0,.3);border-color:rgba(255,255,255,.2);color:#f0f0d8">G${gIdx+1}</span>`}
            <span class="goal-banner-title">${e(gTitle)}</span>
          </div>
          <div class="goal-banner-right">
            ${quarter ? `<span class="quarter-badge">${e(quarter)}</span>` : ''}
            <span class="type-badge clickable" style="background:rgba(0,0,0,.35);color:#f0f0d8;border:1px solid rgba(255,255,255,.2)" onclick="event.stopPropagation();cycleStatus('${g.id}','${status}','goal',this)">${e(status || '—')}</span>
            <span class="goal-chevron" id="${cardId}-ch">›</span>
          </div>
        </div>
        ${totalCount > 0 ? `<div class="goal-hp"><div class="hp-bar-wrap"><span class="hp-label">PROG</span><div class="hp-bar"><div class="hp-fill" style="width:${hpPct}%;background:${hpColor}"></div></div><span class="hp-pct">${hpPct}%</span></div></div>` : ''}
        <div class="goal-body" id="${cardId}">
          <div class="goal-projects">
            ${projectsInner}
          </div>
        </div>
      </div>`;
  }

  const goalsGridHTML = goals.length
    ? goals.map((g, i) => renderGoalCard(g, i)).join('')
    : `<div class="empty-state">🎯 No goals yet<br><span>Add one via Telegram: <code>add goal: [name] q[1-4]</code></span></div>`;

  const inboxHTML = unlinkedProjects.length ? `
    <div class="inbox-section">
      <div class="inbox-head">📁 INBOX — NO GOAL LINKED</div>
      <div class="gb-window" style="padding:0;overflow:hidden">
        ${unlinkedProjects.map((p, i) => renderProjectRow(p, 9000 + i)).join('')}
      </div>
    </div>` : '';

  // ── Tasks tab: grouped by status ─────────────────────────────────────────────
  const taskOrder = ['In Progress', 'Blocked', 'Todo', 'Done'];
  const grouped = {};
  for (const t of tasks) {
    const s = propStatus(t) || 'Todo';
    if (!grouped[s]) grouped[s] = [];
    grouped[s].push(t);
  }

  const tasksTabHTML = tasks.length
    ? taskOrder.flatMap(status => {
        const items = grouped[status] || [];
        if (!items.length) return [];
        const color = STATUS_COLOR[status] || '#787870';
        return [`
          <div class="task-group">
            <div class="task-group-head" style="color:${color}">${status.toUpperCase()} <span class="group-count">${items.length}</span></div>
            ${items.map((t, i) => {
              const code    = propCode(t);
              const due     = propDate(t);
              const proj    = propProject(t);
              const isDone  = status === 'Done' || status === 'Completed';
              return `
              <div class="item-card task-card" onclick="toggle(this)" style="--c:${color};animation-delay:${i * 0.04}s">
                <div class="item-row">
                  <button class="check-btn${isDone ? ' done' : ''}" style="border-color:${color};margin-top:3px" onclick="event.stopPropagation();markDone('${t.id}',this)">${isDone ? '✓' : ''}</button>
                  <div class="item-main">
                    <div class="item-title ${isDone ? 'done-text' : ''}">${code ? `<span class="code-pill">${e(code)}</span> ` : ''}${e(propTitle(t))}</div>
                    <div class="item-meta">
                      ${due ? `<span class="meta-tag">📅 ${e(fmtDate(due))}</span>` : ''}
                      ${proj ? `<span class="meta-tag">📁 ${e(proj)}</span>` : ''}
                    </div>
                  </div>
                  <div class="chevron">›</div>
                </div>
                <div class="item-expand">
                  ${propNotes(t) ? `<div class="expand-row"><span class="expand-label">Notes</span>${e(propNotes(t))}</div>` : ''}
                </div>
              </div>`;
            }).join('')}
          </div>`];
      }).join('')
    : `<div class="empty-state">✅ No tasks yet<br><span>Add one via Telegram: <code>add task: [name] by [date]</code></span></div>`;

  // ── Full HTML ─────────────────────────────────────────────────────────────────
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <title>Ooppyy · Planning HQ</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap');

    /* ── PALETTE ── */
    :root {
      --bg:     #080808;
      --s1:     #0f0f0d;
      --s2:     #161614;
      --s3:     #1e1e1c;
      --txt:    #d0d0b0;
      --txt2:   #484840;
      --sep:    #242420;
      --red:    #c82820;
      --red2:   #e04030;
      --brd:    #b8b8a0;
      --gbf:    'Press Start 2P', ui-monospace, monospace;
      --mono:   ui-monospace, 'Courier New', monospace;
      --shadow: 4px 4px 0 0 var(--red);
    }
    html.light {
      --bg:     #c8c8a8;
      --s1:     #d8d8b8;
      --s2:     #c0c0a0;
      --s3:     #b0b090;
      --txt:    #080808;
      --txt2:   #585848;
      --sep:    #989878;
      --brd:    #282820;
      --shadow: 4px 4px 0 0 var(--red);
    }

    /* ── RESET ── */
    *{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
    html,body{background:var(--bg);color:var(--txt)}
    body{font-family:var(--mono);min-height:100dvh;padding-bottom:calc(env(safe-area-inset-bottom)+88px);transition:background .2s,color .2s}

    /* ── GB WINDOW (core container — double border + red pixel shadow) ── */
    .gb-window{background:var(--s1);border:2px solid var(--brd);box-shadow:inset 0 0 0 2px var(--bg),inset 0 0 0 4px var(--brd),var(--shadow)}

    /* ── TOP BAR ── */
    .topbar{position:sticky;top:0;z-index:99;background:var(--bg);border-bottom:3px solid var(--red);padding:calc(env(safe-area-inset-top)+6px) 12px 0}
    .topbar-inner{display:flex;align-items:center;justify-content:space-between;padding-bottom:10px}
    .gb-title{display:flex;align-items:center;gap:8px}
    .gb-cursor{color:var(--red);font-family:var(--gbf);font-size:8px;animation:blink 1s step-end infinite}
    @keyframes blink{0%,100%{opacity:1}50%{opacity:0}}
    .gb-brand{font-family:var(--gbf);font-size:10px;letter-spacing:.08em;color:var(--txt);text-shadow:2px 2px 0 var(--red)}
    .topbar-right{display:flex;align-items:center;gap:10px}
    .live-dot{width:8px;height:8px;background:var(--red);box-shadow:0 0 8px var(--red);animation:pulse 2s infinite;flex-shrink:0}
    @keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.3;transform:scale(.75)}}
    .theme-btn{font-family:var(--gbf);font-size:7px;color:var(--txt);background:none;border:2px solid var(--brd);padding:5px 9px;cursor:pointer;letter-spacing:.02em;transition:all .1s}
    .theme-btn:active{background:var(--red);color:#f0f0e0;border-color:var(--red)}

    /* ── TABS ── */
    .tabs{display:flex;margin:0 -12px;border-top:1px solid var(--sep);overflow-x:auto;scrollbar-width:none}
    .tabs::-webkit-scrollbar{display:none}
    .tab{flex:1;background:none;border:none;border-bottom:3px solid transparent;color:var(--txt2);font-family:var(--gbf);font-size:6px;padding:10px 6px 12px;cursor:pointer;letter-spacing:.07em;white-space:nowrap;text-align:center;transition:all .15s;min-width:80px}
    .tab.active{color:var(--red);border-bottom-color:var(--red)}
    .tab:active{color:var(--txt)}

    /* ── TRAINER CARD (Mission) ── */
    .trainer-card{margin:14px 12px 0;padding:14px}
    .tc-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid var(--sep)}
    .tc-label{font-family:var(--gbf);font-size:6px;letter-spacing:.12em;color:var(--red);text-transform:uppercase}
    .mission-text{font-size:.8rem;line-height:1.75;color:var(--txt);margin-bottom:10px;min-height:2.8rem}
    .mission-text.empty{color:var(--txt2);font-style:italic;font-size:.74rem}
    .tc-stats{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
    .stat-chip{font-family:var(--gbf);font-size:6px;color:var(--txt2);background:var(--s2);border:1px solid var(--sep);padding:4px 8px;letter-spacing:.04em}
    .deadline-chip{font-family:var(--gbf);font-size:6px;padding:4px 8px;border:1px solid;letter-spacing:.04em}

    /* ── FEED ── */
    .feed{padding:14px 12px 0}
    .tab-content{display:none}
    .tab-content.active{display:block}

    /* ── GOAL CARD (Pokemon Storage Box) ── */
    .goal-card{margin-bottom:16px;opacity:0;transform:translateY(8px);animation:gb-in .4s cubic-bezier(.25,.46,.45,.94) forwards;cursor:pointer;overflow:hidden}
    @keyframes gb-in{to{opacity:1;transform:none}}
    .goal-banner{font-family:var(--gbf);font-size:7px;letter-spacing:.06em;background:var(--gc,var(--red));color:#f0f0d8;padding:8px 12px;display:flex;align-items:center;justify-content:space-between;user-select:none;border-bottom:2px solid var(--bg)}
    .goal-banner-left{display:flex;align-items:center;gap:8px;min-width:0;flex:1;overflow:hidden}
    .goal-banner-title{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .goal-banner-right{display:flex;align-items:center;gap:7px;flex-shrink:0}
    .goal-chevron{color:#f0f0d8;font-size:.9rem;transition:transform .22s;flex-shrink:0}
    .goal-chevron.open{transform:rotate(90deg)}
    .goal-hp{padding:6px 12px 0}
    .hp-bar-wrap{display:flex;align-items:center;gap:6px}
    .hp-label{font-family:var(--gbf);font-size:5px;color:var(--txt2);letter-spacing:.04em;flex-shrink:0;min-width:26px}
    .hp-bar{flex:1;height:6px;background:var(--s3);border:1px solid var(--sep)}
    .hp-fill{height:100%;transition:width .5s ease}
    .hp-pct{font-family:var(--gbf);font-size:5px;color:var(--txt2);flex-shrink:0;min-width:24px;text-align:right}
    .goal-body{max-height:0;overflow:hidden;transition:max-height .4s ease}
    .goal-body.open{max-height:1400px}
    .goal-projects{border-top:1px solid var(--sep)}
    .goal-empty-projects{font-size:.72rem;color:var(--txt2);padding:10px 12px;line-height:1.8;font-style:italic}
    .link-hint code{font-family:var(--mono);font-size:.68rem;background:var(--s3);padding:1px 5px;border:1px solid var(--sep);color:var(--txt2)}
    .quarter-badge{font-family:var(--gbf);font-size:5px;color:#f0f0d8;background:rgba(0,0,0,.25);border:1px solid rgba(255,255,255,.2);padding:3px 7px;letter-spacing:.04em}

    /* ── PROJECT ROW (Menu item) ── */
    .proj-row{background:var(--s2);border-bottom:1px solid var(--sep);cursor:pointer;transition:background .1s}
    .proj-row:last-child{border-bottom:none}
    .proj-row:active{background:var(--s3)}
    .proj-row-main{display:flex;align-items:center;gap:7px;padding:9px 12px;min-height:38px}
    .proj-cursor{color:var(--red);font-size:.7rem;flex-shrink:0;opacity:0;transition:opacity .1s}
    .proj-row:hover .proj-cursor{opacity:1}
    .proj-name{font-size:.78rem;font-weight:600;color:var(--txt);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .proj-spacer{flex:1}
    .proj-due{font-family:var(--gbf);font-size:5px;color:var(--txt2)}
    .proj-chevron{color:var(--txt2);font-size:.9rem;transition:transform .2s;flex-shrink:0}
    .proj-chevron.open{transform:rotate(90deg)}

    /* ── TASKS INSIDE PROJECT ── */
    .proj-tasks{max-height:0;overflow:hidden;transition:max-height .3s ease;background:var(--s3)}
    .proj-tasks.open{max-height:700px}
    .task-item{display:flex;align-items:center;gap:8px;padding:7px 12px 7px 22px;border-bottom:1px solid var(--sep)}
    .task-item:last-child{border-bottom:none}
    .task-body{flex:1;min-width:0;font-size:.76rem;color:var(--txt);display:flex;align-items:center;gap:5px;flex-wrap:wrap}
    .task-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .task-right{display:flex;align-items:center;gap:5px;flex-shrink:0}
    .task-due{font-family:var(--gbf);font-size:5px;color:var(--txt2)}
    .task-empty{font-size:.7rem;color:var(--txt2);padding:8px 12px 8px 22px;line-height:1.7;font-style:italic}
    .task-empty code{font-family:var(--mono);font-size:.68rem;background:var(--s2);padding:1px 5px;border:1px solid var(--sep);color:var(--txt2)}

    /* ── INBOX ── */
    .inbox-section{margin-top:18px}
    .inbox-head{font-family:var(--gbf);font-size:7px;letter-spacing:.1em;color:var(--txt2);padding:0 2px 8px;text-transform:uppercase}

    /* ── TASK TAB CARDS ── */
    .task-group{margin-bottom:14px}
    .task-group-head{font-family:var(--gbf);font-size:6px;letter-spacing:.1em;color:var(--txt2);padding:4px 0 8px;text-transform:uppercase;display:flex;align-items:center;gap:8px;border-bottom:1px solid var(--sep);margin-bottom:6px}
    .group-count{font-family:var(--mono);font-size:.65rem;color:var(--txt2);background:var(--s2);padding:1px 7px;border:1px solid var(--sep)}
    .item-card{background:var(--s1);border:1px solid var(--sep);border-left:3px solid var(--c,var(--brd));margin-bottom:6px;opacity:0;transform:translateY(8px);animation:gb-in .35s cubic-bezier(.25,.46,.45,.94) forwards;cursor:pointer;transition:background .1s}
    .item-card:active{background:var(--s2)}
    .item-row{display:flex;align-items:flex-start;gap:9px;padding:10px 12px}
    .item-main{flex:1;min-width:0}
    .item-title{font-size:.82rem;font-weight:600;line-height:1.5;color:var(--txt);margin-bottom:4px}
    .done-text{opacity:.3;text-decoration:line-through}
    .item-meta{display:flex;gap:5px;flex-wrap:wrap;align-items:center}
    .chevron{color:var(--txt2);font-size:.9rem;transition:transform .22s;flex-shrink:0;align-self:flex-start;margin-top:3px}
    .item-card.open .chevron{transform:rotate(90deg)}
    .item-expand{max-height:0;overflow:hidden;transition:max-height .3s ease}
    .item-card.open .item-expand{max-height:200px}
    .expand-row{font-size:.78rem;line-height:1.6;color:var(--txt2);padding:6px 12px 10px;border-left:2px solid var(--red)}
    .expand-label{font-family:var(--gbf);font-size:5px;letter-spacing:.08em;color:var(--red);display:block;margin-bottom:3px;text-transform:uppercase}

    /* ── TYPE BADGE (Pokemon-style status) ── */
    .type-badge{font-family:var(--gbf);font-size:6px;letter-spacing:.04em;padding:3px 7px 4px;text-transform:uppercase;display:inline-block;line-height:1}
    .type-badge.clickable{cursor:pointer;transition:filter .15s}
    .type-badge.clickable:active{filter:brightness(1.4)}

    /* ── PILL-BTN (inline interactive status) ── */
    .pill-btn{cursor:pointer;user-select:none;transition:opacity .15s;-webkit-tap-highlight-color:transparent;min-height:28px;min-width:28px}
    .pill-btn:active{opacity:.6}

    /* ── CODE PILL ── */
    .code-pill{font-family:var(--gbf);font-size:5px;background:var(--s3);border:1px solid var(--sep);padding:2px 6px;color:var(--txt2);letter-spacing:.04em}
    /* ── META TAG ── */
    .meta-tag{font-size:.7rem;color:var(--txt2);background:var(--s2);border:1px solid var(--sep);padding:2px 8px}

    /* ── EMPTY STATE ── */
    .empty-state{text-align:center;padding:24px 16px;color:var(--txt2);font-family:var(--gbf);font-size:7px;letter-spacing:.05em;line-height:2;background:var(--s1);border:1px dashed var(--sep);margin-bottom:7px}
    .empty-state span{font-family:var(--mono);font-size:.72rem;letter-spacing:0;display:block;margin-top:8px}
    .empty-state code{font-family:var(--mono);font-size:.7rem;background:var(--s2);padding:2px 6px;border:1px solid var(--sep);color:var(--txt)}

    /* ── FOOTER ── */
    .footer{padding:24px 16px 10px;text-align:center;color:var(--txt2);font-family:var(--gbf);font-size:6px;letter-spacing:.05em;line-height:2.2}
    .footer a{color:var(--red);text-decoration:none}

    /* ── A BUTTON (FAB) ── */
    .fab{position:fixed;bottom:calc(env(safe-area-inset-bottom)+22px);right:18px;width:54px;height:54px;border-radius:50%;background:var(--red);border:3px solid var(--brd);color:#f0f0d8;font-family:var(--gbf);font-size:10px;cursor:pointer;box-shadow:0 5px 0 0 #7a1510,4px 4px 0 5px #000;z-index:200;display:flex;align-items:center;justify-content:center;transition:transform .1s,box-shadow .1s;letter-spacing:.04em;padding:0}
    .fab:active{transform:translateY(4px);box-shadow:0 1px 0 0 #7a1510,1px 1px 0 5px #000}

    /* ── DIALOG SHEET (Pokemon dialog style) ── */
    .sheet-overlay{position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:300;opacity:0;pointer-events:none;transition:opacity .2s}
    .sheet-overlay.open{opacity:1;pointer-events:all}
    .bottom-sheet{position:fixed;bottom:0;left:0;right:0;z-index:301;background:var(--s1);border-top:3px solid var(--brd);box-shadow:inset 0 3px 0 var(--bg),inset 0 6px 0 var(--brd),0 -4px 0 4px #000;padding:0 0 calc(env(safe-area-inset-bottom)+16px);transform:translateY(100%);transition:transform .3s cubic-bezier(.32,.72,0,1);max-height:80dvh;overflow-y:auto}
    .bottom-sheet.open{transform:translateY(0)}
    .sheet-handle{width:32px;height:3px;background:var(--sep);margin:10px auto 0}
    .sheet-header{padding:12px 16px 0;display:flex;align-items:center;justify-content:space-between}
    .sheet-title{font-family:var(--gbf);font-size:8px;letter-spacing:.08em;color:var(--txt);text-transform:uppercase}
    .sheet-close{background:var(--s3);border:2px solid var(--brd);color:var(--txt);font-family:var(--gbf);font-size:7px;width:28px;height:28px;cursor:pointer;display:flex;align-items:center;justify-content:center}
    .sheet-body{padding:14px 16px 0}
    .sheet-label{font-family:var(--gbf);font-size:6px;letter-spacing:.08em;text-transform:uppercase;color:var(--txt2);margin-bottom:6px;display:block}
    .sheet-input{width:100%;background:var(--s3);border:2px solid var(--brd);color:var(--txt);font-size:1rem;padding:10px 12px;outline:none;font-family:var(--mono);margin-bottom:12px;-webkit-appearance:none}
    .sheet-input:focus{border-color:var(--red)}
    .sheet-row{display:flex;gap:10px;margin-bottom:12px}
    .sheet-row .sheet-input{margin-bottom:0;flex:1}
    .sheet-select{width:100%;background:var(--s3);border:2px solid var(--brd);color:var(--txt);font-size:1rem;padding:10px 12px;outline:none;font-family:var(--mono);margin-bottom:12px;-webkit-appearance:none}
    .sheet-type-pills{display:flex;gap:0;margin-bottom:14px;border:2px solid var(--brd)}
    .sheet-type-pill{flex:1;background:var(--s2);border:none;border-right:2px solid var(--brd);color:var(--txt2);font-family:var(--gbf);font-size:6px;padding:9px 4px;cursor:pointer;text-align:center;transition:all .1s;letter-spacing:.04em}
    .sheet-type-pill:last-child{border-right:none}
    .sheet-type-pill.active{background:var(--red);color:#f0f0d8}
    .sheet-submit{width:100%;background:var(--red);border:2px solid var(--brd);color:#f0f0d8;font-family:var(--gbf);font-size:7px;padding:13px;cursor:pointer;margin-top:4px;transition:all .1s;letter-spacing:.06em;text-transform:uppercase;box-shadow:3px 3px 0 0 #000}
    .sheet-submit:active{transform:translate(2px,2px);box-shadow:1px 1px 0 0 #000}
    .sheet-submit:disabled{opacity:.4;cursor:not-allowed}
    .sheet-err{font-family:var(--gbf);font-size:6px;color:#e04030;padding:8px 10px;background:rgba(200,40,30,.1);border:1px solid rgba(200,40,30,.3);margin-bottom:10px;display:none;letter-spacing:.04em;line-height:1.8}

    /* ── CHECK BUTTON ── */
    .check-btn{width:32px;height:32px;border:2px solid;background:transparent;cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center;transition:all .15s;padding:0;font-family:var(--gbf);font-size:6px;color:transparent}
    .check-btn:active{transform:scale(.8)}
    .check-btn.done{background:#20a040;border-color:#20a040;color:#f0f0d8}

    /* ── INLINE ADD BTN ── */
    .add-inline{background:none;border:1px dashed var(--sep);color:var(--txt2);font-family:var(--gbf);font-size:6px;padding:6px 10px;cursor:pointer;display:flex;align-items:center;gap:6px;margin:6px 12px 8px;transition:all .1s;width:calc(100% - 24px);letter-spacing:.04em}
    .add-inline:active{background:var(--s3)}

    /* ── POKEMON MAP / GAME BOY CONSOLE ── */
    .gb-console{background:#a8a090;border-radius:6px 6px 26px 8px;padding:10px 12px 14px;box-shadow:2px 4px 0 0 #706858,inset 0 1px 0 rgba(255,255,255,.25);max-width:min(370px,calc(100vw - 16px));margin:12px auto 0;user-select:none}
    .gb-screen-surround{background:#2a2820;border-radius:4px 4px 2px 2px;padding:8px 10px 10px;margin-bottom:8px;box-shadow:inset 0 2px 5px rgba(0,0,0,.7)}
    .gb-led-row{display:flex;align-items:center;gap:6px;margin-bottom:5px}
    .gb-power-led2{width:6px;height:6px;border-radius:50%;background:#20c040;box-shadow:0 0 6px #20c040;animation:pulse 2s infinite;flex-shrink:0}
    .gb-screen-label2{font-family:var(--gbf);font-size:6px;color:#a0a090;letter-spacing:.15em}
    .gb-screen{background:#587840;position:relative;overflow:hidden;border:2px solid #181810;aspect-ratio:15/13;width:100%}
    .tile-map{display:grid;grid-template-columns:repeat(15,1fr);grid-template-rows:repeat(13,1fr);width:100%;height:100%;position:absolute;inset:0}
    .tile{position:relative}
    .t0{background:#487840}.t1{background:#c0a860}.t2{background:#101008}
    .t3{background:#b82018}.t4{background:#1858b0}.t5{background:#b07018}
    .t6{background:#602898}
    .t7,.t8,.t9,.t10{background:#907040;border-top:2px solid rgba(0,0,0,.5)}
    .t11{background:#284020}
    .tile-lbl{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-family:var(--gbf);font-size:3.5px;color:rgba(255,255,255,.8);text-align:center;line-height:1.4;letter-spacing:.02em;pointer-events:none;padding:1px}
    /* Sprites */
    .sprite{position:absolute;z-index:20;width:calc(100%/15);height:calc(100%/13);transition:left .12s linear,top .12s linear;display:flex;align-items:center;justify-content:center}
    .ash-spr{width:72%;height:86%;margin:auto;background:#3060c8;position:relative;border-radius:1px}
    .ash-spr::before{content:'';position:absolute;top:-36%;left:5%;width:90%;height:36%;background:#c82820;border-radius:2px 2px 0 0}
    .ash-spr::after{content:'';position:absolute;top:-14%;left:18%;width:64%;height:24%;background:#f0c090;border-radius:1px}
    .pika-spr{width:65%;height:70%;margin:auto;background:#f0c020;border-radius:30%;position:relative}
    .pika-spr::before{content:'';position:absolute;top:-44%;left:8%;width:22%;height:50%;background:#f0c020;border-radius:50% 50% 0 0;border-top:2px solid #805010}
    .pika-spr::after{content:'';position:absolute;top:-44%;right:8%;width:22%;height:50%;background:#f0c020;border-radius:50% 50% 0 0;border-top:2px solid #805010}
    /* Map dialog box */
    .map-dialog{position:absolute;bottom:0;left:0;right:0;background:var(--s1);border-top:2px solid var(--brd);box-shadow:inset 0 2px 0 var(--bg),inset 0 4px 0 var(--brd);padding:5px 7px 7px;transform:translateY(100%);transition:transform .22s cubic-bezier(.32,.72,0,1);z-index:30;max-height:58%;overflow-y:auto}
    .map-dialog.open{transform:translateY(0)}
    .map-dlg-hdr{font-family:var(--gbf);font-size:6px;letter-spacing:.08em;color:var(--red);margin-bottom:4px;display:flex;align-items:center;justify-content:space-between}
    .map-dlg-close{background:none;border:1px solid var(--sep);color:var(--txt2);font-family:var(--gbf);font-size:5px;padding:2px 5px;cursor:pointer;-webkit-tap-highlight-color:transparent}
    /* D-pad + buttons */
    .gb-controls{display:flex;justify-content:space-between;align-items:flex-start;padding:0 4px}
    .dpad{display:grid;grid-template-areas:'. u .' 'l c r' '. d .';grid-template-columns:38px 38px 38px;grid-template-rows:38px 38px 38px}
    .dp-u{grid-area:u}.dp-d{grid-area:d}.dp-l{grid-area:l}.dp-r{grid-area:r}
    .dp-c{grid-area:c;background:#383828}
    .dp-btn{background:#383828;border:1px solid #282818;color:#888878;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:10px;padding:0;-webkit-tap-highlight-color:transparent;transition:background .08s}
    .dp-btn:active{background:#181808;color:#c0c0a8}
    .gb-ab{display:flex;flex-direction:column;align-items:flex-end;gap:6px}
    .ab-row{display:flex;gap:10px;align-items:center}
    .map-ab-btn{width:34px;height:34px;border-radius:50%;border:2px solid rgba(0,0,0,.35);font-family:var(--gbf);font-size:7px;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 3px 0 rgba(0,0,0,.4);transition:transform .1s,box-shadow .1s;-webkit-tap-highlight-color:transparent;color:#f0f0e0;letter-spacing:.04em}
    .map-ab-btn:active{transform:translateY(3px);box-shadow:0 0 0 rgba(0,0,0,.4)}
    .map-a-btn{background:#c82820}.map-b-btn{background:#282880}
    .map-ss-row{display:flex;gap:6px;justify-content:center}
    .map-ss-btn{background:#484838;border:none;border-radius:10px;color:#888878;font-family:var(--gbf);font-size:4px;padding:4px 8px;cursor:pointer;letter-spacing:.06em;-webkit-tap-highlight-color:transparent}
    .map-ss-btn:active{background:#282820;color:#c0c0a8}
    .map-hint{text-align:center;font-family:var(--gbf);font-size:5px;color:var(--txt2);letter-spacing:.05em;padding:6px 0 0}

    /* ── TOAST (dialog message style) ── */
    .toast{position:fixed;bottom:calc(env(safe-area-inset-bottom)+86px);left:50%;transform:translateX(-50%) translateY(16px);background:var(--s1);border:2px solid var(--brd);box-shadow:inset 0 0 0 2px var(--bg),inset 0 0 0 4px var(--brd),3px 3px 0 0 #000;padding:10px 16px;font-family:var(--gbf);font-size:7px;letter-spacing:.06em;color:var(--txt);z-index:400;opacity:0;transition:all .25s;pointer-events:none;white-space:nowrap}
    .toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
  </style>
</head>
<body>

<!-- TOP BAR -->
<div class="topbar">
  <div class="topbar-inner">
    <div class="gb-title">
      <span class="gb-cursor">▶</span>
      <span class="gb-brand">OOPPYY OS</span>
    </div>
    <div class="topbar-right">
      <span class="live-dot"></span>
      <button class="theme-btn" id="theme-btn" onclick="toggleTheme()">DMG</button>
    </div>
  </div>
  <div class="tabs">
    <button class="tab active" data-tab="os" onclick="setTab('os')">OS VIEW</button>
    <button class="tab" data-tab="tasks" onclick="setTab('tasks')">TASKS</button>
    <button class="tab" data-tab="map" onclick="setTab('map')">MAP</button>
  </div>
</div>

<!-- TRAINER CARD -->
<div class="gb-window trainer-card">
  <div class="tc-header">
    <span class="tc-label">AGENT #0 · MISSION</span>
    <span class="live-dot"></span>
  </div>
  <div class="mission-text${missionText ? '' : ' empty'}">${missionText ? e(missionText) : 'No mission set — send via Telegram: set mission: [text]'}</div>
  <div class="tc-stats">
    ${deadlineBanner()}
    <span class="stat-chip">🎯 ${activeGoals} GOAL${activeGoals !== 1 ? 'S' : ''}</span>
    <span class="stat-chip">✓ ${openTasks} OPEN</span>
  </div>
</div>

<!-- FEED -->
<div class="feed">

  <!-- OS VIEW TAB -->
  <div class="tab-content active" id="tab-os">
    ${goalsGridHTML}
    ${inboxHTML}
  </div>

  <!-- TASKS TAB -->
  <div class="tab-content" id="tab-tasks">
    ${tasksTabHTML}
  </div>

  <!-- MAP TAB -->
  <div class="tab-content" id="tab-map">
    <div class="gb-console">
      <div class="gb-screen-surround">
        <div class="gb-led-row">
          <div class="gb-power-led2"></div>
          <span class="gb-screen-label2">OOPPYY OS · PALLET TOWN</span>
        </div>
        <div class="gb-screen" id="map-screen">
          <div class="tile-map" id="tile-map"></div>
          <div class="sprite" id="sprite-ash" style="left:calc(100%/15*7);top:calc(100%/13*5)">
            <div class="ash-spr"></div>
          </div>
          <div class="sprite" id="sprite-pika" style="left:calc(100%/15*7);top:calc(100%/13*6)">
            <div class="pika-spr"></div>
          </div>
          <div class="map-dialog" id="map-dialog">
            <div class="map-dlg-hdr">
              <span id="map-dlg-title">────</span>
              <button class="map-dlg-close" onclick="closeMapDialog()">✕ B</button>
            </div>
            <div id="map-dlg-body"></div>
          </div>
        </div>
      </div>
      <div class="gb-controls">
        <div class="dpad">
          <button class="dp-btn dp-u" onpointerdown="startMapMove('up')" onpointerup="stopMapMove()" onpointerleave="stopMapMove()">▲</button>
          <button class="dp-btn dp-l" onpointerdown="startMapMove('left')" onpointerup="stopMapMove()" onpointerleave="stopMapMove()">◄</button>
          <div class="dp-c"></div>
          <button class="dp-btn dp-r" onpointerdown="startMapMove('right')" onpointerup="stopMapMove()" onpointerleave="stopMapMove()">►</button>
          <button class="dp-btn dp-d" onpointerdown="startMapMove('down')" onpointerup="stopMapMove()" onpointerleave="stopMapMove()">▼</button>
        </div>
        <div class="gb-ab">
          <div class="ab-row">
            <button class="map-ab-btn map-b-btn" onclick="mapAction('b')">B</button>
            <button class="map-ab-btn map-a-btn" onclick="mapAction('a')">A</button>
          </div>
          <div class="map-ss-row">
            <button class="map-ss-btn" onclick="mapAction('select')">SELECT</button>
            <button class="map-ss-btn" onclick="mapAction('start')">START</button>
          </div>
        </div>
      </div>
      <div class="map-hint">ARROWS/WASD · A=ENTER · B=BACK</div>
    </div>
  </div>

</div>

<div class="footer">
  OOPPYY · AGENT #0 · PLANNING HQ<br>
  <a href="/api/view">INTEL</a> &nbsp;·&nbsp; <a href="/api/scout">SCOUT</a> &nbsp;·&nbsp; <a href="/api/plan">PLAN</a>
</div>

<!-- A BUTTON (FAB) -->
<button class="fab" onclick="showAddSheet()" aria-label="Add item">A</button>

<!-- TOAST -->
<div class="toast" id="toast"></div>

<!-- SHEET OVERLAY -->
<div class="sheet-overlay" id="sheet-overlay" onclick="closeSheet()"></div>

<!-- BOTTOM SHEET -->
<div class="bottom-sheet" id="bottom-sheet">
  <div class="sheet-handle"></div>
  <div class="sheet-header">
    <div class="sheet-title" id="sheet-title">Add Task</div>
    <button class="sheet-close" onclick="closeSheet()">✕</button>
  </div>
  <div class="sheet-body">
    <div class="sheet-type-pills">
      <button class="sheet-type-pill active" onclick="setSheetType('task')">✅ Task</button>
      <button class="sheet-type-pill" onclick="setSheetType('project')">📁 Project</button>
      <button class="sheet-type-pill" onclick="setSheetType('goal')">🎯 Goal</button>
    </div>
    <div id="sheet-err" class="sheet-err"></div>

    <!-- Task fields -->
    <div id="sheet-task-fields">
      <label class="sheet-label">Task name</label>
      <input class="sheet-input" id="sheet-name" placeholder="e.g. Write proposal draft" type="text" autocomplete="off">
      <label class="sheet-label">Due date (optional)</label>
      <input class="sheet-input" id="sheet-due" type="date">
      <label class="sheet-label">Project (optional)</label>
      <input class="sheet-input" id="sheet-proj-name" placeholder="Project name" type="text" autocomplete="off">
    </div>

    <!-- Project fields -->
    <div id="sheet-project-fields" style="display:none">
      <label class="sheet-label">Project name</label>
      <input class="sheet-input" id="sheet-name-proj" placeholder="e.g. Launch website" type="text" autocomplete="off">
      <label class="sheet-label">Due date (optional)</label>
      <input class="sheet-input" id="sheet-due-proj" type="date">
      <label class="sheet-label">Goal (optional)</label>
      <input class="sheet-input" id="sheet-goal-name" placeholder="Goal name" type="text" autocomplete="off">
    </div>

    <!-- Goal fields -->
    <div id="sheet-goal-fields" style="display:none">
      <label class="sheet-label">Goal name</label>
      <input class="sheet-input" id="sheet-name-goal" placeholder="e.g. Revenue $10k MRR" type="text" autocomplete="off">
      <label class="sheet-label">Quarter</label>
      <select class="sheet-select" id="sheet-quarter">
        <option value="">Select quarter</option>
        <option value="Q1">Q1</option>
        <option value="Q2">Q2</option>
        <option value="Q3">Q3</option>
        <option value="Q4">Q4</option>
      </select>
    </div>

    <button class="sheet-submit" id="sheet-submit" onclick="submitSheet()">Add Task</button>
  </div>
</div>

<script>
  // ── Theme ──
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

  // ── Tabs ──
  function setTab(key) {
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === key));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === 'tab-' + key));
  }

  // ── Goal card toggle ──
  function toggleGoal(id, ev) {
    ev.stopPropagation();
    const body = document.getElementById(id);
    const ch   = document.getElementById(id + '-ch');
    if (!body) return;
    const isOpen = body.classList.toggle('open');
    if (ch) ch.classList.toggle('open', isOpen);
  }

  // ── Project row toggle ──
  function toggleProj(id, ev) {
    ev.stopPropagation();
    const tasks = document.getElementById(id);
    const ch    = document.getElementById(id + '-ch');
    if (!tasks) return;
    const isOpen = tasks.classList.toggle('open');
    if (ch) ch.classList.toggle('open', isOpen);
  }

  // ── Task card toggle (tasks tab) ──
  function toggle(el) { el.classList.toggle('open'); }

  // ── Interactive actions ──
  const STATUS_CYCLES = {
    task:    ['Todo', 'In Progress', 'Done', 'Blocked'],
    project: ['Planning', 'Active', 'On Hold', 'Completed'],
    goal:    ['Active', 'Paused', 'Completed'],
  };
  const STATUS_COLORS = {
    'Active':'#0ea5e9','Todo':'#0ea5e9','Planning':'#0ea5e9',
    'In Progress':'#f59e0b','On Hold':'#f59e0b','Paused':'#94a3b8',
    'Done':'#22c55e','Completed':'#22c55e','Blocked':'#ef4444',
  };

  function showToast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2200);
  }

  async function apiAction(body) {
    const r = await fetch('/api/plan-action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return r.json();
  }

  async function markDone(pageId, btn) {
    if (btn.classList.contains('done')) return;
    btn.classList.add('done');
    btn.textContent = '✓';
    const item = btn.closest('.task-item') || btn.closest('.item-card');
    if (item) {
      item.querySelectorAll('.task-name,.item-title').forEach(el => el.classList.add('done-text'));
      item.querySelectorAll('.pill-btn').forEach(el => {
        el.style.background = '#22c55e20'; el.style.color = '#22c55e'; el.style.borderColor = '#22c55e40';
        el.textContent = 'Done';
      });
    }
    const res = await apiAction({ action: 'mark-done', pageId });
    if (!res.success) {
      btn.classList.remove('done'); btn.textContent = '';
      showToast('❌ Failed to update');
    } else {
      showToast('✅ Done!');
    }
  }

  async function cycleStatus(pageId, currentStatus, type, pillEl) {
    const cycle = STATUS_CYCLES[type] || STATUS_CYCLES.task;
    const idx = cycle.indexOf(currentStatus);
    const nextStatus = cycle[(idx + 1) % cycle.length];
    const color = STATUS_COLORS[nextStatus] || '#94a3b8';
    const prevColor = STATUS_COLORS[currentStatus] || '#94a3b8';
    // Optimistic update
    pillEl.style.background = color + '20';
    pillEl.style.color = color;
    pillEl.style.borderColor = color + '40';
    pillEl.textContent = nextStatus;
    const res = await apiAction({ action: 'update-status', pageId, status: nextStatus });
    if (!res.success) {
      pillEl.style.background = prevColor + '20';
      pillEl.style.color = prevColor;
      pillEl.style.borderColor = prevColor + '40';
      pillEl.textContent = currentStatus;
      showToast('❌ Failed to update');
    } else {
      showToast('↻ ' + nextStatus);
    }
  }

  // ── Bottom sheet ──
  let _sheetType = 'task';
  let _sheetCtx  = {};

  function showAddSheet(type, ctx) {
    _sheetType = type || 'task';
    _sheetCtx  = ctx || {};
    setSheetType(_sheetType);
    if (ctx && ctx.projectName) document.getElementById('sheet-proj-name').value = ctx.projectName;
    if (ctx && ctx.goalName) document.getElementById('sheet-goal-name').value = ctx.goalName;
    document.getElementById('sheet-overlay').classList.add('open');
    document.getElementById('bottom-sheet').classList.add('open');
    setTimeout(() => {
      const ids = { task: 'sheet-name', project: 'sheet-name-proj', goal: 'sheet-name-goal' };
      const el = document.getElementById(ids[_sheetType]);
      if (el) el.focus();
    }, 360);
  }

  function closeSheet() {
    document.getElementById('sheet-overlay').classList.remove('open');
    document.getElementById('bottom-sheet').classList.remove('open');
    const errEl = document.getElementById('sheet-err');
    errEl.style.display = 'none'; errEl.textContent = '';
    ['sheet-name','sheet-name-proj','sheet-name-goal','sheet-due','sheet-due-proj','sheet-proj-name','sheet-goal-name'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
    document.getElementById('sheet-quarter').value = '';
  }

  function setSheetType(type) {
    _sheetType = type;
    const types = ['task','project','goal'];
    document.querySelectorAll('.sheet-type-pill').forEach((p, i) => p.classList.toggle('active', types[i] === type));
    document.getElementById('sheet-task-fields').style.display    = type === 'task'    ? '' : 'none';
    document.getElementById('sheet-project-fields').style.display = type === 'project' ? '' : 'none';
    document.getElementById('sheet-goal-fields').style.display    = type === 'goal'    ? '' : 'none';
    const labels = { task: 'Add Task', project: 'Add Project', goal: 'Add Goal' };
    document.getElementById('sheet-title').textContent  = labels[type];
    document.getElementById('sheet-submit').textContent = labels[type];
  }

  async function submitSheet() {
    const btn = document.getElementById('sheet-submit');
    const errEl = document.getElementById('sheet-err');
    errEl.style.display = 'none';
    btn.disabled = true;
    btn.textContent = 'Saving…';

    let body;
    try {
      if (_sheetType === 'task') {
        const name = document.getElementById('sheet-name').value.trim();
        if (!name) throw new Error('Task name is required');
        body = { action: 'create-task', name,
          dueDate: document.getElementById('sheet-due').value || undefined,
          projectName: document.getElementById('sheet-proj-name').value.trim() || undefined };
      } else if (_sheetType === 'project') {
        const name = document.getElementById('sheet-name-proj').value.trim();
        if (!name) throw new Error('Project name is required');
        body = { action: 'create-project', name,
          dueDate: document.getElementById('sheet-due-proj').value || undefined,
          goalName: document.getElementById('sheet-goal-name').value.trim() || undefined };
      } else {
        const name = document.getElementById('sheet-name-goal').value.trim();
        if (!name) throw new Error('Goal name is required');
        body = { action: 'create-goal', name,
          quarter: document.getElementById('sheet-quarter').value || undefined };
      }
    } catch (err) {
      errEl.textContent = err.message; errEl.style.display = 'block';
      btn.disabled = false; btn.textContent = { task:'Add Task', project:'Add Project', goal:'Add Goal' }[_sheetType];
      return;
    }

    const res = await apiAction(body);
    btn.disabled = false;
    btn.textContent = { task:'Add Task', project:'Add Project', goal:'Add Goal' }[_sheetType];
    if (!res.success) {
      errEl.textContent = res.error || 'Failed to create'; errEl.style.display = 'block';
    } else {
      closeSheet();
      showToast('✨ Created! Pull down to refresh.');
    }
  }

  // Close sheet on Escape key
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });

  // ── POKEMON MAP ENGINE ─────────────────────────────────────────────────────
  (function(){
    const MW=15,MH=13;
    // Tile types: 0=grass 1=path 2=wall 3=mission 4=goal 5=project 6=task
    //             7=mission-door 8=goal-door 9=project-door 10=task-door 11=tree
    const MAP=[
      [2,2,2,2,2,2,2,2,2,2,2,2,2,2,2],
      [2,0,0,0,0,0,0,1,0,0,0,0,0,0,2],
      [2,0,3,3,0,4,4,4,4,0,5,5,5,0,2],
      [2,0,3,3,0,4,4,4,4,0,5,5,5,0,2],
      [2,1,1,7,1,1,8,1,9,1,1,1,1,1,2],
      [2,0,0,1,0,0,1,1,1,0,0,0,0,0,2],
      [2,0,0,1,0,0,1,1,1,0,0,0,0,0,2],
      [2,11,0,0,0,0,6,6,6,0,0,0,11,0,2],
      [2,0,0,0,0,0,6,6,6,0,0,0,0,0,2],
      [2,0,0,0,0,0,0,10,0,0,0,0,0,0,2],
      [2,0,0,0,0,0,0,1,0,0,0,0,0,0,2],
      [2,0,0,0,0,0,0,1,0,0,0,0,0,0,2],
      [2,2,2,2,2,2,2,2,2,2,2,2,2,2,2],
    ];
    const WALKABLE=new Set([0,1,7,8,9,10]);
    const TRIGGERS={7:'mission',8:'goal',9:'project',10:'task'};
    // [row, col, label] for building name overlays
    const LBLS=[[2,2,'MISSION\\nHQ'],[2,5,'GOAL\\nCENTER'],[2,11,'PROJECT\\nMART'],[7,6,'TASK\\nGYM']];

    // Server-injected data
    const BDATA={
      mission:{title:'MISSION HQ',content:${JSON.stringify(missionText||'')}},
      goal:{title:'GOAL CENTER',items:${JSON.stringify(goals.map(g=>({name:propTitle(g),status:propStatus(g),code:propCode(g)})))}},
      project:{title:'PROJECT MART',items:${JSON.stringify(projects.map(p=>({name:propTitle(p),status:propStatus(p),code:propCode(p)})))}},
      task:{title:'TASK GYM',items:${JSON.stringify(tasks.slice(0,30).map(t=>({name:propTitle(t),status:propStatus(t),code:propCode(t),done:propStatus(t)==='Done'})))}},
    };

    let ash={r:5,c:7},pika={r:6,c:7},prevAsh={r:5,c:7};
    let mapMoving=false,dlgOpen=false,moveInterval=null;

    function renderMap(){
      const grid=document.getElementById('tile-map');
      if(!grid||grid.dataset.init==='1')return;
      grid.dataset.init='1';
      let html='';
      for(let r=0;r<MH;r++){for(let c=0;c<MW;c++){html+='<div class="tile t'+MAP[r][c]+'"></div>';}}
      grid.innerHTML=html;
      const tiles=grid.children;
      LBLS.forEach(function(entry){
        var r=entry[0],c=entry[1],lbl=entry[2];
        var idx=r*MW+c;
        if(tiles[idx])tiles[idx].innerHTML='<span class="tile-lbl">'+lbl.replace('\\n','<br>')+'</span>';
      });
      for(var r=0;r<MH;r++){for(var c=0;c<MW;c++){
        var t=MAP[r][c];
        if(t>=7&&t<=10){var idx=r*MW+c;if(tiles[idx])tiles[idx].innerHTML='<span class="tile-lbl" style="font-size:8px">\u25bc</span>';}
      }}
    }

    function setSprites(){
      var a=document.getElementById('sprite-ash'),p=document.getElementById('sprite-pika');
      if(a){a.style.left=(ash.c/MW*100)+'%';a.style.top=(ash.r/MH*100)+'%';}
      if(p){p.style.left=(pika.c/MW*100)+'%';p.style.top=(pika.r/MH*100)+'%';}
    }

    function mapMove(dir){
      if(mapMoving||dlgOpen)return;
      const D={up:[-1,0],down:[1,0],left:[0,-1],right:[0,1]};
      const[dr,dc]=D[dir]||[0,0];
      const nr=ash.r+dr,nc=ash.c+dc;
      if(nr<0||nr>=MH||nc<0||nc>=MW)return;
      if(!WALKABLE.has(MAP[nr][nc]))return;
      mapMoving=true;
      prevAsh={...ash};
      ash={r:nr,c:nc};
      setSprites();
      setTimeout(()=>{
        pika={...prevAsh};
        setSprites();
        mapMoving=false;
        const trig=TRIGGERS[MAP[nr][nc]];
        if(trig)openMapDlg(trig);
      },130);
    }

    window.startMapMove=function(dir){
      mapMove(dir);
      clearInterval(moveInterval);
      moveInterval=setInterval(()=>mapMove(dir),200);
    };
    window.stopMapMove=function(){clearInterval(moveInterval);moveInterval=null;};

    function openMapDlg(type){
      const d=BDATA[type];if(!d)return;
      dlgOpen=true;
      document.getElementById('map-dlg-title').textContent=d.title;
      const SC={'Active':'#2080c8','Todo':'#787870','Planning':'#4890b8','In Progress':'#c87820','On Hold':'#806840','Paused':'#8060a0','Done':'#20a040','Completed':'#1a9060','Blocked':'#c82050'};
      let html='';
      if(d.content!==undefined){
        html='<p style="font-family:var(--gbf);font-size:6px;line-height:2.2;color:var(--txt);padding:4px 0">'+(d.content||'No mission set. Telegram: set mission: [text]')+'</p>';
      } else if(d.items){
        if(!d.items.length){html='<p style="color:var(--txt2);font-family:var(--gbf);font-size:6px;padding:4px 0">None yet.</p>';}
        else{
          html=d.items.slice(0,12).map(function(it){
            var col=SC[it.status]||'#787870';
            var nm=it.name.length>24?it.name.slice(0,24)+'\u2026':it.name;
            return '<div style="display:flex;align-items:center;gap:5px;padding:3px 0;border-bottom:1px solid var(--sep)">'
              +(it.code?'<span style="font-family:var(--gbf);font-size:5px;color:var(--txt2);flex-shrink:0">'+it.code+'</span>':'')
              +'<span style="flex:1;font-size:.7rem;color:var(--txt);'+(it.done?'text-decoration:line-through;opacity:.35':'')+'">'+ nm+'</span>'
              +'<span style="font-family:var(--gbf);font-size:5px;padding:2px 4px;background:'+col+';color:#f0f0e0;flex-shrink:0">'+(it.status||'\u2014')+'</span>'
              +'</div>';
          }).join('');
          if(d.items.length>12)html+='<p style="color:var(--txt2);font-family:var(--gbf);font-size:5px;padding-top:5px">+'+(d.items.length-12)+' more\u2026</p>';
        }
      }
      document.getElementById('map-dlg-body').innerHTML=html;
      document.getElementById('map-dialog').classList.add('open');
    }

    window.closeMapDialog=function(){dlgOpen=false;document.getElementById('map-dialog').classList.remove('open');};

    window.mapAction=function(btn){
      if(btn==='a'){const trig=TRIGGERS[MAP[ash.r][ash.c]];if(trig)openMapDlg(trig);}
      else if(btn==='b')closeMapDialog();
      else if(btn==='start')setTab('os');
      else if(btn==='select')setTab('tasks');
    };

    // Keyboard controls — only active when MAP tab is visible
    window.addEventListener('keydown',function(ev){
      if(!document.getElementById('tab-map')?.classList.contains('active'))return;
      const km={ArrowUp:'up',ArrowDown:'down',ArrowLeft:'left',ArrowRight:'right',w:'up',s:'down',a:'left',d:'right'};
      const dir=km[ev.key];
      if(dir){ev.preventDefault();if(!moveInterval)startMapMove(dir);}
      if(ev.key==='Enter'||ev.key===' '){ev.preventDefault();mapAction('a');}
      if(ev.key==='Escape')closeMapDialog();
    });
    window.addEventListener('keyup',function(ev){
      const km={ArrowUp:1,ArrowDown:1,ArrowLeft:1,ArrowRight:1,w:1,s:1,a:1,d:1};
      if(km[ev.key])stopMapMove();
    });

    // Patch setTab to init map on first visit
    const _origSetTab=window.setTab;
    window.setTab=function(key){
      _origSetTab(key);
      if(key==='map'){renderMap();setSprites();}
    };

    // Pre-render (map tab not yet visible but DOM exists)
    renderMap();
    setSprites();
  })();
</script>
</body>
</html>`;
}

// ── Setup prompt page ───────────────────────────────────────────────────────────

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
