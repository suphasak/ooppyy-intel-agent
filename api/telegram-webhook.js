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

  const props = {
    Name: { title: [{ text: { content: name } }] },
    Status: { select: { name: 'Todo' } },
    Priority: { select: { name: 'Medium' } },
    ...(dueDate ? { 'Due Date': { date: { start: dueDate } } } : {}),
  };

  await createNotionPage(tasksDbId, props);
  const dateStr = dueDate ? ` · Due ${dueDate}` : '';
  return sendTelegram(chatId, `✅ <b>Task added</b>\n📌 ${name}${dateStr}`);
}

async function handleAddProject(chatId, text) {
  const { projects: projectsDbId } = dbIds();
  if (!projectsDbId) return sendTelegram(chatId, missingDbMsg('Projects'));

  // "add project: [name] due [date]"
  const m = text.match(/add\s+project:\s*(.+?)\s+due\s+(.+)/i);
  if (!m) return sendTelegram(chatId, '❓ Format: <code>add project: [name] due [date]</code>\nExample: <code>add project: Website Relaunch due 2026-04-01</code>');

  const name = m[1].trim();
  const dueDate = parseDate(m[2].trim());

  const props = {
    Name: { title: [{ text: { content: name } }] },
    Status: { select: { name: 'Planning' } },
    Priority: { select: { name: 'Medium' } },
    ...(dueDate ? { 'Due Date': { date: { start: dueDate } } } : {}),
  };

  await createNotionPage(projectsDbId, props);
  const dateStr = dueDate ? ` · Due ${dueDate}` : '';
  return sendTelegram(chatId, `📁 <b>Project added</b>\n${name}${dateStr}`);
}

async function handleAddGoal(chatId, text) {
  const { goals: goalsDbId } = dbIds();
  if (!goalsDbId) return sendTelegram(chatId, missingDbMsg('Goals'));

  // "add goal: [name] q[1-4]"
  const m = text.match(/add\s+goal:\s*(.+?)\s+q([1-4])/i);
  if (!m) return sendTelegram(chatId, '❓ Format: <code>add goal: [name] q[1-4]</code>\nExample: <code>add goal: Launch AI product Q2</code>');

  const name = m[1].trim();
  const quarter = `Q${m[2]}`;

  const props = {
    Name: { title: [{ text: { content: name } }] },
    Quarter: { select: { name: quarter } },
    Status: { select: { name: 'Active' } },
    Priority: { select: { name: 'High' } },
  };

  await createNotionPage(goalsDbId, props);
  return sendTelegram(chatId, `🎯 <b>Goal added</b>\n${name} · ${quarter}`);
}

async function handleLinkProject(chatId, text) {
  const { projects: projectsDbId, goals: goalsDbId } = dbIds();
  if (!projectsDbId || !goalsDbId) return sendTelegram(chatId, missingDbMsg('Projects/Goals'));

  // "link project: [name] to goal: [goal name]"
  const m = text.match(/link\s+project:\s*(.+?)\s+to\s+goal:\s*(.+)/i);
  if (!m) return sendTelegram(chatId, '❓ Format: <code>link project: [name] to goal: [goal name]</code>\nExample: <code>link project: Website Relaunch to goal: Q2 Brand Expansion</code>');

  const projectName = m[1].trim();
  const goalName = m[2].trim();

  // Find project by name
  const projects = await queryDb(projectsDbId, {
    property: 'Name', title: { contains: projectName },
  });
  if (!projects.length) return sendTelegram(chatId, `❌ Project not found: <b>${projectName}</b>\nCheck spelling or use <code>show tasks</code> to list projects.`);

  // Find goal by name (to verify it exists)
  const goals = await queryDb(goalsDbId, {
    property: 'Name', title: { contains: goalName },
  });
  if (!goals.length) return sendTelegram(chatId, `❌ Goal not found: <b>${goalName}</b>\nAdd it first with: <code>add goal: ${goalName} q2</code>`);

  const projectPage = projects[0];
  const matchedGoal = goals[0];
  const matchedGoalName = matchedGoal.properties?.Name?.title?.[0]?.plain_text || goalName;

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

  const aiPlan = await groq(
    `You are Ooppyy, a sharp and slightly sarcastic Chief of Staff. The user needs a weekly plan.\n\nTasks this week:\n${taskLines}\n\nProjects:\n${projectLines}\n\nWrite a concise, energetic weekly plan in plain text (no markdown). Max 200 words. Lead with top 3 priorities. Be direct and witty. No fluff.`
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
  const top3 = await groq(
    `You are Ooppyy, a sharp Chief of Staff. Pick the top 3 most important tasks from this list and explain in one sentence each why they matter. Be concise and direct.\n\nTasks:\n${taskLines}\n\nFormat: numbered list, max 3 items, plain text.`
  );

  return sendTelegram(chatId, `🎯 <b>Today's Focus</b>\n\n${top3}`);
}

async function handleDone(chatId, text) {
  const { tasks: tasksDbId } = dbIds();
  if (!tasksDbId) return sendTelegram(chatId, missingDbMsg('Tasks'));

  // "done: [task name]"
  const m = text.match(/done:\s*(.+)/i);
  if (!m) return sendTelegram(chatId, '❓ Format: <code>done: [task name]</code>\nExample: <code>done: Write proposal</code>');

  const searchName = m[1].trim().toLowerCase();
  const tasks = await queryDb(tasksDbId, { property: 'Status', select: { does_not_equal: 'Done' } });

  const match = tasks.find(t => propTitle(t).toLowerCase().includes(searchName));
  if (!match) {
    return sendTelegram(chatId, `❓ No open task found matching "<b>${searchName}</b>". Use <code>show tasks</code> to see all open tasks.`);
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
      msg += `  • ${propTitle(t)}${due}${pri}\n`;
    }
  }

  msg += `\n<a href="https://ooppyy-intel-agent.vercel.app/api/plan">Full Planning HQ →</a>`;
  return sendTelegram(chatId, msg);
}

async function handleBreakDown(chatId, text) {
  const { tasks: tasksDbId } = dbIds();
  if (!tasksDbId) return sendTelegram(chatId, missingDbMsg('Tasks'));

  // "break down: [name]"
  const m = text.match(/break\s+down:\s*(.+)/i);
  if (!m) return sendTelegram(chatId, '❓ Format: <code>break down: [goal or project name]</code>\nExample: <code>break down: Website Relaunch</code>');

  const name = m[1].trim();

  await sendTelegram(chatId, `⚙️ Breaking down "<b>${name}</b>"…`);

  const subtasks = await groq(
    `You are Ooppyy, a sharp Chief of Staff. Break down the following goal or project into 5-7 concrete, actionable tasks.\n\nGoal/Project: "${name}"\n\nReturn ONLY a JSON array of strings, each being a task name. No explanation, no markdown, just the JSON array. Example: ["Task 1","Task 2","Task 3"]`
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
  return `🤖 <b>Ooppyy Planning Agent</b> — commands:\n\n` +
    `📌 <code>add task: [name] by [date]</code>\n` +
    `📁 <code>add project: [name] due [date]</code>\n` +
    `🎯 <code>add goal: [name] q[1-4]</code>\n` +
    `📅 <code>plan my week</code>\n` +
    `🎯 <code>focus today</code> or <code>what's my focus</code>\n` +
    `✅ <code>done: [task name]</code>\n` +
    `📋 <code>show tasks</code>\n` +
    `🔨 <code>break down: [goal/project name]</code>\n` +
    `🔗 <code>link project: [name] to goal: [goal name]</code>\n\n` +
    `<a href="https://ooppyy-intel-agent.vercel.app/api/plan">Planning HQ →</a>`;
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
      if (/^add\s+task:/i.test(text)) {
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
        await sendTelegram(chatId, helpMessage());
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
