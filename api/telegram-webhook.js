const NOTION_HEADERS = () => ({
  'Authorization': `Bearer ${process.env.NOTION_TOKEN}`,
  'Content-Type': 'application/json',
  'Notion-Version': '2022-06-28',
});

// ── Helpers ──────────────────────────────────────────────────────────────────

async function sendTelegram(chatId, text, parseMode = 'HTML') {
  const r = await fetch(
    `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: parseMode,
        disable_web_page_preview: true,
      }),
    }
  );
  if (!r.ok) console.error('Telegram send error:', await r.text());
}

function dbIds() {
  return {
    tasks:    process.env.NOTION_TASKS_DB_ID,
    projects: process.env.NOTION_PROJECTS_DB_ID,
    goals:    process.env.NOTION_GOALS_DB_ID,
  };
}

function missingDbMsg(which) {
  return `⚙️ <b>${which} DB not configured.</b>\n\nRun <code>/api/plan-setup</code> first, then add the env vars to Vercel:\n• NOTION_TASKS_DB_ID\n• NOTION_PROJECTS_DB_ID\n• NOTION_GOALS_DB_ID`;
}

function parseDate(raw) {
  // Accept "YYYY-MM-DD", "DD/MM/YYYY", "tomorrow", "next monday", etc.
  if (!raw) return null;
  const clean = raw.trim().toLowerCase();
  if (clean === 'tomorrow') {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  }
  // Try ISO / natural
  const d = new Date(raw.trim());
  if (!isNaN(d)) return d.toISOString().slice(0, 10);
  return null;
}

function sgNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Singapore' }));
}

function isoDate(d) { return d.toISOString().slice(0, 10); }

function startOfWeek(d) {
  const day = d.getDay(); // 0=Sun
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Mon start
  return new Date(d.setDate(diff));
}

// ── Notion helpers ────────────────────────────────────────────────────────────

async function queryDb(dbId, filter) {
  const body = filter ? { filter } : {};
  const r = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
    method: 'POST',
    headers: NOTION_HEADERS(),
    body: JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`Notion query error: ${JSON.stringify(data)}`);
  return data.results || [];
}

async function createNotionPage(parentDbId, properties) {
  const r = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: NOTION_HEADERS(),
    body: JSON.stringify({ parent: { database_id: parentDbId }, properties }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`Notion create error: ${JSON.stringify(data)}`);
  return data;
}

async function updateNotionPage(pageId, properties) {
  const r = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: 'PATCH',
    headers: NOTION_HEADERS(),
    body: JSON.stringify({ properties }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`Notion update error: ${JSON.stringify(data)}`);
  return data;
}

function propTitle(page) {
  const t = page.properties?.Name?.title;
  return t && t.length ? t[0].plain_text : '(untitled)';
}

function propStatus(page) {
  return page.properties?.Status?.select?.name || '';
}

function propDate(page) {
  return page.properties?.['Due Date']?.date?.start || '';
}

function propPriority(page) {
  return page.properties?.Priority?.select?.name || '';
}

function propCode(page) {
  return page.properties?.Code?.rich_text?.[0]?.plain_text || '';
}

async function getNextCode(dbId, prefix) {
  const pages = await queryDb(dbId, {});
  let maxNum = 0;
  for (const page of pages) {
    const code = propCode(page);
    if (code.startsWith(prefix)) {
      const num = parseInt(code.slice(prefix.length), 10);
      if (!isNaN(num) && num > maxNum) maxNum = num;
    }
  }
  return `${prefix}${maxNum + 1}`;
}

async function findByCode(dbId, code) {
  const pages = await queryDb(dbId, {
    property: 'Code',
    rich_text: { equals: code.toUpperCase() },
  });
  return pages[0] || null;
}

// ── Mission helpers ────────────────────────────────────────────────────────────

async function getMission() {
  const missionPageId = process.env.NOTION_MISSION_PAGE_ID;
  if (!missionPageId) return '';
  try {
    const r = await fetch(`https://api.notion.com/v1/pages/${missionPageId}`, {
      headers: NOTION_HEADERS(),
    });
    const data = await r.json();
    return data.properties?.title?.title?.[0]?.plain_text || '';
  } catch {
    return '';
  }
}

async function handleSetMission(chatId, text) {
  const m = text.match(/set\s+mission:\s*(.+)/i);
  if (!m) return sendTelegram(chatId, '❓ Format: <code>set mission: [your mission statement]</code>');

  const missionText = m[1].trim();
  let missionPageId = process.env.NOTION_MISSION_PAGE_ID;

  if (!missionPageId) {
    // Auto-create mission page under Planning HQ
    const planningPageId = process.env.NOTION_PLANNING_PAGE_ID;
    if (!planningPageId) {
      return sendTelegram(chatId, '⚙️ <b>NOTION_PLANNING_PAGE_ID not set.</b>\nRun <code>/api/plan-setup</code> first.');
    }
    const r = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: NOTION_HEADERS(),
      body: JSON.stringify({
        parent: { page_id: planningPageId },
        icon: { type: 'emoji', emoji: '🎯' },
        properties: {
          title: { title: [{ text: { content: missionText } }] },
        },
      }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(`Failed to create mission page: ${JSON.stringify(data)}`);
    missionPageId = data.id;
    return sendTelegram(chatId,
      `🎯 <b>Mission created!</b>\n\n"${missionText}"\n\n⚙️ Add this to Vercel env vars and redeploy:\n<code>NOTION_MISSION_PAGE_ID=${missionPageId}</code>`
    );
  }

  // Update existing
  const r = await fetch(`https://api.notion.com/v1/pages/${missionPageId}`, {
    method: 'PATCH',
    headers: NOTION_HEADERS(),
    body: JSON.stringify({
      properties: {
        title: { title: [{ text: { content: missionText } }] },
      },
    }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`Failed to update mission: ${JSON.stringify(data)}`);
  return sendTelegram(chatId, `🎯 <b>Mission updated</b>\n\n"${missionText}"`);
}

async function handleShowMission(chatId) {
  const { goals: goalsDbId } = dbIds();
  const [mission, goals] = await Promise.all([
    getMission(),
    goalsDbId ? queryDb(goalsDbId, {}) : Promise.resolve([]),
  ]);

  if (!mission && !goals.length) {
    return sendTelegram(chatId,
      `🎯 <b>No mission set yet.</b>\n\nSet it with: <code>set mission: [your mission]</code>`
    );
  }

  let msg = `🎯 <b>Mission</b>\n`;
  if (mission) msg += `"${mission}"\n`;
  else msg += `<i>Not set — use: set mission: [text]</i>\n`;

  if (goals.length) {
    msg += `\n<b>Goals (${goals.length})</b>\n`;
    for (const g of goals) {
      const code = propCode(g);
      const status = propStatus(g);
      const q = g.properties?.Quarter?.select?.name || '';
      const icon = status === 'Completed' ? '✅' : status === 'Paused' ? '⏸' : '🎯';
      msg += `${icon} <code>${code || '?'}</code> ${propTitle(g)}${q ? ` · ${q}` : ''} · ${status}\n`;
    }
  }

  msg += `\n<a href="https://ooppyy-intel-agent.vercel.app/api/plan">Planning HQ →</a>`;
  return sendTelegram(chatId, msg);
}

async function handleMyStatus(chatId) {
  const { tasks: tasksDbId, projects: projectsDbId, goals: goalsDbId } = dbIds();
  if (!tasksDbId || !goalsDbId) return sendTelegram(chatId, missingDbMsg('Tasks/Goals'));

  const today = isoDate(sgNow());
  const [mission, goals, activeProjects, openTasks, overdueTasks] = await Promise.all([
    getMission(),
    queryDb(goalsDbId, {}),
    projectsDbId ? queryDb(projectsDbId, { property: 'Status', select: { does_not_equal: 'Completed' } }) : Promise.resolve([]),
    queryDb(tasksDbId, { property: 'Status', select: { does_not_equal: 'Done' } }),
    queryDb(tasksDbId, {
      and: [
        { property: 'Status', select: { does_not_equal: 'Done' } },
        { property: 'Due Date', date: { before: today } },
      ],
    }),
  ]);

  const activeGoals = goals.filter(g => propStatus(g) === 'Active');
  const deadline = new Date('2026-03-31');
  const daysLeft = Math.ceil((deadline - new Date()) / (1000 * 60 * 60 * 24));

  let msg = `📊 <b>OS Status</b>\n`;
  if (mission) msg += `\n🎯 <i>"${mission}"</i>\n`;

  msg += `\n📅 <b>${daysLeft} days to end-of-month</b>\n`;
  msg += `\n<b>Active Goals (${activeGoals.length})</b>\n`;
  for (const g of activeGoals) {
    const code = propCode(g);
    const q = g.properties?.Quarter?.select?.name || '';
    msg += `• <code>${code || '?'}</code> ${propTitle(g)}${q ? ` · ${q}` : ''}\n`;
  }

  msg += `\n<b>Active Projects (${activeProjects.length})</b>\n`;
  activeProjects.slice(0, 5).forEach(p => {
    const code = propCode(p);
    const due = propDate(p) ? ` · Due ${propDate(p)}` : '';
    msg += `• <code>${code || '?'}</code> ${propTitle(p)}${due}\n`;
  });

  msg += `\n<b>Tasks</b>\n`;
  msg += `• ${openTasks.length} open · ${overdueTasks.length} overdue\n`;

  msg += `\n<a href="https://ooppyy-intel-agent.vercel.app/api/plan">Full view →</a>`;
  return sendTelegram(chatId, msg);
}

async function handleShowGoals(chatId) {
  const { goals: goalsDbId, projects: projectsDbId } = dbIds();
  if (!goalsDbId) return sendTelegram(chatId, missingDbMsg('Goals'));

  const [goals, projects] = await Promise.all([
    queryDb(goalsDbId, {}),
    projectsDbId ? queryDb(projectsDbId, { property: 'Status', select: { does_not_equal: 'Completed' } }) : Promise.resolve([]),
  ]);

  if (!goals.length) {
    return sendTelegram(chatId, '🎯 No goals yet.\nAdd one: <code>add goal: [name] q[1-4]</code>');
  }

  // Build projects-per-goal map
  const projByGoal = new Map();
  for (const p of projects) {
    const gName = p.properties?.Goal?.rich_text?.[0]?.plain_text || '';
    if (!projByGoal.has(gName)) projByGoal.set(gName, []);
    projByGoal.get(gName).push(p);
  }

  let msg = `🌲 <b>Goals &amp; Projects</b>\n`;
  for (const g of goals) {
    const code = propCode(g);
    const status = propStatus(g);
    const q = g.properties?.Quarter?.select?.name || '';
    const icon = status === 'Completed' ? '✅' : '🎯';
    msg += `\n${icon} <b><code>${code || '?'}</code> ${propTitle(g)}</b> · ${q} · ${status}\n`;

    const linkedProjects = projByGoal.get(propTitle(g)) || [];
    if (linkedProjects.length) {
      for (const p of linkedProjects) {
        const pCode = propCode(p);
        const due = propDate(p) ? ` · ${propDate(p)}` : '';
        msg += `   📁 <code>${pCode || '?'}</code> ${propTitle(p)}${due}\n`;
      }
    } else {
      msg += `   <i>No projects linked · use: link project: P# to goal: ${code || propTitle(g)}</i>\n`;
    }
  }

  msg += `\n<a href="https://ooppyy-intel-agent.vercel.app/api/plan">Planning HQ →</a>`;
  return sendTelegram(chatId, msg);
}

// ── Groq ──────────────────────────────────────────────────────────────────────

async function groq(prompt) {
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.6,
      max_tokens: 1000,
    }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`Groq error: ${JSON.stringify(data)}`);
  return data.choices[0].message.content.trim();
}

// ── Command handlers ──────────────────────────────────────────────────────────

async function handleAddTask(chatId, text) {
  const { tasks: tasksDbId } = dbIds();
  if (!tasksDbId) return sendTelegram(chatId, missingDbMsg('Tasks'));

  // "add task: [name] by [date]"
  const m = text.match(/add\s+task:\s*(.+?)\s+by\s+(.+)/i);
  if (!m) return sendTelegram(chatId, '❓ Format: <code>add task: [name] by [date]</code>\nExample: <code>add task: Write proposal by 2026-03-25</code>');

  const name = m[1].trim();
  const dueDate = parseDate(m[2].trim());

  const code = await getNextCode(tasksDbId, 'T');
  const props = {
    Name: { title: [{ text: { content: name } }] },
    Code: { rich_text: [{ text: { content: code } }] },
    Status: { select: { name: 'Todo' } },
    Priority: { select: { name: 'Medium' } },
    ...(dueDate ? { 'Due Date': { date: { start: dueDate } } } : {}),
  };

  await createNotionPage(tasksDbId, props);
  const dateStr = dueDate ? ` · Due ${dueDate}` : '';
  return sendTelegram(chatId, `✅ <b>Task added</b>\n<code>${code}</code> ${name}${dateStr}`);
}

async function handleAddProject(chatId, text) {
  const { projects: projectsDbId } = dbIds();
  if (!projectsDbId) return sendTelegram(chatId, missingDbMsg('Projects'));

  // "add project: [name] due [date]"
  const m = text.match(/add\s+project:\s*(.+?)\s+due\s+(.+)/i);
  if (!m) return sendTelegram(chatId, '❓ Format: <code>add project: [name] due [date]</code>\nExample: <code>add project: Website Relaunch due 2026-04-01</code>');

  const name = m[1].trim();
  const dueDate = parseDate(m[2].trim());

  const code = await getNextCode(projectsDbId, 'P');
  const props = {
    Name: { title: [{ text: { content: name } }] },
    Code: { rich_text: [{ text: { content: code } }] },
    Status: { select: { name: 'Planning' } },
    Priority: { select: { name: 'Medium' } },
    ...(dueDate ? { 'Due Date': { date: { start: dueDate } } } : {}),
  };

  await createNotionPage(projectsDbId, props);
  const dateStr = dueDate ? ` · Due ${dueDate}` : '';
  return sendTelegram(chatId, `📁 <b>Project added</b>\n<code>${code}</code> ${name}${dateStr}`);
}

async function handleAddGoal(chatId, text) {
  const { goals: goalsDbId } = dbIds();
  if (!goalsDbId) return sendTelegram(chatId, missingDbMsg('Goals'));

  // "add goal: [name] q[1-4]"
  const m = text.match(/add\s+goal:\s*(.+?)\s+q([1-4])/i);
  if (!m) return sendTelegram(chatId, '❓ Format: <code>add goal: [name] q[1-4]</code>\nExample: <code>add goal: Launch AI product Q2</code>');

  const name = m[1].trim();
  const quarter = `Q${m[2]}`;

  const code = await getNextCode(goalsDbId, 'G');
  const props = {
    Name: { title: [{ text: { content: name } }] },
    Code: { rich_text: [{ text: { content: code } }] },
    Quarter: { select: { name: quarter } },
    Status: { select: { name: 'Active' } },
    Priority: { select: { name: 'High' } },
  };

  await createNotionPage(goalsDbId, props);
  return sendTelegram(chatId, `🎯 <b>Goal added</b>\n<code>${code}</code> ${name} · ${quarter}`);
}

async function handleLinkProject(chatId, text) {
  const { projects: projectsDbId, goals: goalsDbId } = dbIds();
  if (!projectsDbId || !goalsDbId) return sendTelegram(chatId, missingDbMsg('Projects/Goals'));

  // "link project: P2 to goal: G1"  or full names
  const m = text.match(/link\s+project:\s*(.+?)\s+to\s+goal:\s*(.+)/i);
  if (!m) return sendTelegram(chatId, '❓ Format: <code>link project: P2 to goal: G1</code>\nor full names: <code>link project: Website Relaunch to goal: Q2 Brand Expansion</code>');

  const projectRef = m[1].trim();
  const goalRef = m[2].trim();

  // Find project — by code (P#) or name
  let projectPage;
  if (/^P\d+$/i.test(projectRef)) {
    projectPage = await findByCode(projectsDbId, projectRef);
  } else {
    const projects = await queryDb(projectsDbId, { property: 'Name', title: { contains: projectRef } });
    projectPage = projects[0];
  }
  if (!projectPage) return sendTelegram(chatId, `❌ Project not found: <b>${projectRef}</b>\nUse <code>show tasks</code> to see projects with codes.`);

  // Find goal — by code (G#) or name
  let matchedGoal;
  if (/^G\d+$/i.test(goalRef)) {
    matchedGoal = await findByCode(goalsDbId, goalRef);
  } else {
    const goals = await queryDb(goalsDbId, { property: 'Name', title: { contains: goalRef } });
    matchedGoal = goals[0];
  }
  if (!matchedGoal) return sendTelegram(chatId, `❌ Goal not found: <b>${goalRef}</b>\nAdd it first with: <code>add goal: [name] q2</code>`);

  const matchedGoalName = matchedGoal.properties?.Name?.title?.[0]?.plain_text || goalRef;

  // Update the project's Goal field
  await fetch(`https://api.notion.com/v1/pages/${projectPage.id}`, {
    method: 'PATCH',
    headers: NOTION_HEADERS(),
    body: JSON.stringify({
      properties: {
        Goal: { rich_text: [{ text: { content: matchedGoalName } }] },
      },
    }),
  });

  const projectTitle = projectPage.properties?.Name?.title?.[0]?.plain_text || projectName;
  return sendTelegram(chatId, `🔗 <b>Linked</b>\n📁 ${projectTitle} → 🎯 ${matchedGoalName}`);
}

async function handlePlanMyWeek(chatId) {
  const { tasks: tasksDbId, projects: projectsDbId } = dbIds();
  if (!tasksDbId || !projectsDbId) return sendTelegram(chatId, missingDbMsg('Tasks/Projects'));

  const now = sgNow();
  const weekStart = isoDate(startOfWeek(new Date(now)));
  const weekEnd = isoDate(new Date(new Date(weekStart).setDate(new Date(weekStart).getDate() + 6)));

  const [tasks, projects] = await Promise.all([
    queryDb(tasksDbId, {
      and: [
        { property: 'Status', select: { does_not_equal: 'Done' } },
        { property: 'Due Date', date: { on_or_before: weekEnd } },
      ],
    }),
    queryDb(projectsDbId, {
      and: [
        { property: 'Status', select: { does_not_equal: 'Completed' } },
        { property: 'Due Date', date: { on_or_before: weekEnd } },
      ],
    }),
  ]);

  const taskLines = tasks.map(t => `- ${propTitle(t)} [${propStatus(t)}] due ${propDate(t)}`).join('\n') || 'No tasks this week.';
  const projectLines = projects.map(p => `- ${propTitle(p)} [${propStatus(p)}] due ${propDate(p)}`).join('\n') || 'No projects due this week.';

  const mission = await getMission();
  const missionCtx = mission ? `\nUser's mission: "${mission}"` : '';

  const aiPlan = await groq(
    `You are Ooppyy, a sharp and slightly sarcastic Chief of Staff. The user needs a weekly plan.${missionCtx}\n\nTasks this week:\n${taskLines}\n\nProjects:\n${projectLines}\n\nWrite a concise, energetic weekly plan in plain text (no markdown). Max 200 words. Lead with top 3 priorities aligned to the mission. Be direct and witty. No fluff.`
  );

  const shortDate = now.toLocaleDateString('en-SG', { weekday: 'short', month: 'short', day: 'numeric' });
  return sendTelegram(chatId, `📅 <b>Weekly Plan · ${shortDate}</b>\n\n${aiPlan}`);
}

async function handleFocusToday(chatId) {
  const { tasks: tasksDbId } = dbIds();
  if (!tasksDbId) return sendTelegram(chatId, missingDbMsg('Tasks'));

  const today = isoDate(sgNow());

  const tasks = await queryDb(tasksDbId, {
    and: [
      { property: 'Status', select: { does_not_equal: 'Done' } },
      {
        or: [
          { property: 'Due Date', date: { equals: today } },
          { property: 'Due Date', date: { before: today } },
        ],
      },
    ],
  });

  if (!tasks.length) {
    return sendTelegram(chatId, `✨ <b>All clear for today!</b>\nNo overdue or due-today tasks. Add some with <code>add task: [name] by [date]</code>`);
  }

  const taskLines = tasks.map(t => `- ${propTitle(t)} [${propPriority(t)} priority] due ${propDate(t) || 'no date'}`).join('\n');
  const mission = await getMission();
  const missionCtx = mission ? `\nMission: "${mission}"` : '';

  const top3 = await groq(
    `You are Ooppyy, a sharp Chief of Staff. Pick the top 3 most important tasks from this list and explain in one sentence each why they matter.${missionCtx} Be concise and direct.\n\nTasks:\n${taskLines}\n\nFormat: numbered list, max 3 items, plain text.`
  );

  return sendTelegram(chatId, `🎯 <b>Today's Focus</b>\n\n${top3}`);
}

async function handleDone(chatId, text) {
  const { tasks: tasksDbId } = dbIds();
  if (!tasksDbId) return sendTelegram(chatId, missingDbMsg('Tasks'));

  // "done: T3" or "done: [task name]"
  const m = text.match(/done:\s*(.+)/i);
  if (!m) return sendTelegram(chatId, '❓ Format: <code>done: T3</code> or <code>done: [task name]</code>');

  const searchRef = m[1].trim();
  let match;

  if (/^T\d+$/i.test(searchRef)) {
    // Find by code
    const page = await findByCode(tasksDbId, searchRef);
    if (page && propStatus(page) !== 'Done') match = page;
  } else {
    // Find by name substring
    const tasks = await queryDb(tasksDbId, { property: 'Status', select: { does_not_equal: 'Done' } });
    match = tasks.find(t => propTitle(t).toLowerCase().includes(searchRef.toLowerCase()));
  }

  if (!match) {
    return sendTelegram(chatId, `❓ No open task found: <b>${searchRef}</b>. Use <code>show tasks</code> to see codes.`);
  }

  await updateNotionPage(match.id, { Status: { select: { name: 'Done' } } });
  return sendTelegram(chatId, `✅ <b>Marked done!</b>\n📌 ${propTitle(match)}`);
}

async function handleShowTasks(chatId) {
  const { tasks: tasksDbId } = dbIds();
  if (!tasksDbId) return sendTelegram(chatId, missingDbMsg('Tasks'));

  const tasks = await queryDb(tasksDbId, { property: 'Status', select: { does_not_equal: 'Done' } });

  if (!tasks.length) {
    return sendTelegram(chatId, '✨ <b>No open tasks!</b>\nAdd one: <code>add task: [name] by [date]</code>');
  }

  const grouped = { 'In Progress': [], 'Todo': [], 'Blocked': [] };
  for (const t of tasks) {
    const s = propStatus(t);
    if (grouped[s]) grouped[s].push(t); else grouped['Todo'].push(t);
  }

  let msg = `📋 <b>Open Tasks (${tasks.length})</b>\n`;
  for (const [status, items] of Object.entries(grouped)) {
    if (!items.length) continue;
    const icon = status === 'In Progress' ? '🔵' : status === 'Blocked' ? '🔴' : '⚪';
    msg += `\n${icon} <b>${status}</b>\n`;
    for (const t of items) {
      const due = propDate(t) ? ` · ${propDate(t)}` : '';
      const pri = propPriority(t) ? ` [${propPriority(t)}]` : '';
      const code = propCode(t);
      const codeStr = code ? `<code>${code}</code> ` : '';
      msg += `  • ${codeStr}${propTitle(t)}${due}${pri}\n`;
    }
  }

  msg += `\n<a href="https://ooppyy-intel-agent.vercel.app/api/plan">Full Planning HQ →</a>`;
  return sendTelegram(chatId, msg);
}

async function handleBreakDown(chatId, text) {
  const { tasks: tasksDbId } = dbIds();
  if (!tasksDbId) return sendTelegram(chatId, missingDbMsg('Tasks'));

  // "break down: P1" or "break down: [name]"
  const m = text.match(/break\s+down:\s*(.+)/i);
  if (!m) return sendTelegram(chatId, '❓ Format: <code>break down: P1</code> or <code>break down: [name]</code>');

  const nameOrCode = m[1].trim();
  let name = nameOrCode;

  // Resolve code to name
  const { goals: goalsDbId2, projects: projectsDbId2 } = dbIds();
  if (/^G\d+$/i.test(nameOrCode) && goalsDbId2) {
    const page = await findByCode(goalsDbId2, nameOrCode);
    if (page) name = propTitle(page);
  } else if (/^P\d+$/i.test(nameOrCode) && projectsDbId2) {
    const page = await findByCode(projectsDbId2, nameOrCode);
    if (page) name = propTitle(page);
  }

  await sendTelegram(chatId, `⚙️ Breaking down "<b>${name}</b>"…`);

  const mission = await getMission();
  const missionCtx = mission ? ` The user's mission is: "${mission}". Make tasks mission-aligned.` : '';

  const subtasks = await groq(
    `You are Ooppyy, a sharp Chief of Staff. Break down the following goal or project into 5-7 concrete, actionable tasks.${missionCtx}\n\nGoal/Project: "${name}"\n\nReturn ONLY a JSON array of strings, each being a task name. No explanation, no markdown, just the JSON array. Example: ["Task 1","Task 2","Task 3"]`
  );

  let taskNames;
  try {
    taskNames = JSON.parse(subtasks);
    if (!Array.isArray(taskNames)) throw new Error('not array');
  } catch {
    // Fallback: split by newline
    taskNames = subtasks.split('\n').map(l => l.replace(/^[\d\-\*\.\s]+/, '').trim()).filter(Boolean).slice(0, 7);
  }

  const created = [];
  for (const taskName of taskNames) {
    if (!taskName) continue;
    await createNotionPage(tasksDbId, {
      Name: { title: [{ text: { content: taskName } }] },
      Status: { select: { name: 'Todo' } },
      Priority: { select: { name: 'Medium' } },
      Project: { rich_text: [{ text: { content: name } }] },
    });
    created.push(taskName);
  }

  let msg = `✅ <b>Broke down "${name}"</b>\nCreated ${created.length} tasks in Notion:\n`;
  created.forEach((t, i) => { msg += `${i + 1}. ${t}\n`; });
  return sendTelegram(chatId, msg);
}

function helpMessage() {
  return `🤖 <b>Ooppyy OS · Agent #0</b>\n\n` +
    `<b>Mission</b>\n` +
    `🎯 <code>set mission: [text]</code>\n` +
    `🎯 <code>show mission</code> · <code>my status</code> · <code>show goals</code>\n\n` +
    `<b>Add</b>\n` +
    `📌 <code>add task: [name] by [date]</code>\n` +
    `📁 <code>add project: [name] due [date]</code>\n` +
    `🎯 <code>add goal: [name] q[1-4]</code>\n` +
    `🔗 <code>link project: P2 to goal: G1</code>\n\n` +
    `<b>Plan</b>\n` +
    `📅 <code>plan my week</code>\n` +
    `🎯 <code>focus today</code> · <code>what's my focus</code>\n` +
    `🔨 <code>break down: P1</code>\n\n` +
    `<b>Update</b>\n` +
    `✅ <code>done: T3</code> · <code>show tasks</code>\n\n` +
    `<a href="https://ooppyy-intel-agent.vercel.app/api/plan">Planning HQ →</a>`;
}

// ── Strategist (free-form AI) ─────────────────────────────────────────────────

async function handleStrategist(chatId, text) {
  // Pull mission + active goals for context
  let mission = '';
  let goalsSummary = '';
  try {
    mission = await getMission();
  } catch (e) { /* non-fatal */ }
  try {
    const { goals: goalsDbId } = dbIds();
    if (goalsDbId) {
      const goals = await queryDb(goalsDbId, {});
      const active = goals.filter(g => g.properties?.Status?.select?.name === 'Active');
      goalsSummary = active.map(g => propTitle(g)).join(', ');
    }
  } catch (e) { /* non-fatal */ }

  const context = [
    mission ? 'Mission: ' + mission : '',
    goalsSummary ? 'Active goals: ' + goalsSummary : '',
  ].filter(Boolean).join('\n');

  const systemContext = context
    ? `You know this about the user:\n${context}\n\n`
    : '';

  const prompt = `${systemContext}You are Ooppyy — a sharp, direct, slightly sarcastic Chief of Staff and second-opinion strategist. You give real, opinionated advice. No fluff, no "great question!", no bullet-point padding. Be concise but complete. Use plain text only — no markdown bold, no asterisks, no hashtags. Short paragraphs are fine.\n\nUser: ${text}`;

  await sendTelegram(chatId, '⏳ thinking...');

  const reply = await groq(prompt);
  await sendTelegram(chatId, reply, 'HTML');
}

// ── Main handler ──────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  // Telegram webhooks are POST only
  if (req.method !== 'POST') return res.status(200).json({ ok: true });

  try {
    const body = req.body;
    const message = body?.message || body?.edited_message;
    if (!message) return res.status(200).json({ ok: true });

    const chatId = message.chat?.id?.toString();
    const text = (message.text || '').trim();

    if (!chatId || !text) return res.status(200).json({ ok: true });

    // Security: only respond to authorised user
    const authorisedId = process.env.TELEGRAM_CHAT_ID?.toString();
    if (authorisedId && chatId !== authorisedId) {
      return res.status(200).json({ ok: true }); // Silently ignore
    }

    const lower = text.toLowerCase();

    try {
      if (/^set\s+mission:/i.test(text)) {
        await handleSetMission(chatId, text);
      } else if (/^show\s+mission|my\s+mission/i.test(lower)) {
        await handleShowMission(chatId);
      } else if (/^my\s+status|os\s+status/i.test(lower)) {
        await handleMyStatus(chatId);
      } else if (/^show\s+goals/i.test(lower)) {
        await handleShowGoals(chatId);
      } else if (/^add\s+task:/i.test(text)) {
        await handleAddTask(chatId, text);
      } else if (/^add\s+project:/i.test(text)) {
        await handleAddProject(chatId, text);
      } else if (/^add\s+goal:/i.test(text)) {
        await handleAddGoal(chatId, text);
      } else if (/^link\s+project:/i.test(text)) {
        await handleLinkProject(chatId, text);
      } else if (/plan\s+my\s+week/i.test(text)) {
        await handlePlanMyWeek(chatId);
      } else if (/focus\s+today|what'?s?\s+my\s+focus/i.test(text)) {
        await handleFocusToday(chatId);
      } else if (/^done:/i.test(text)) {
        await handleDone(chatId, text);
      } else if (/show\s+tasks/i.test(lower)) {
        await handleShowTasks(chatId);
      } else if (/^break\s+down:/i.test(text)) {
        await handleBreakDown(chatId, text);
      } else if (/^\/?(start|help)$/i.test(lower)) {
        await sendTelegram(chatId, helpMessage());
      } else {
        await handleStrategist(chatId, text);
      }
    } catch (cmdErr) {
      console.error('Command error:', cmdErr);
      await sendTelegram(chatId, `⚠️ Error: ${cmdErr.message}`);
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Webhook error:', error);
    return res.status(200).json({ ok: true }); // Always 200 to Telegram
  }
}
