export default async function handler(req, res) {
  try {
    const NOTION_TOKEN    = process.env.NOTION_TOKEN;
    const TASKS_DB_ID     = process.env.NOTION_TASKS_DB_ID;
    const PROJECTS_DB_ID  = process.env.NOTION_PROJECTS_DB_ID;
    const GROQ_API_KEY    = process.env.GROQ_API_KEY;
    const TELEGRAM_BOT    = process.env.TELEGRAM_BOT_TOKEN;
    const TELEGRAM_CHAT   = process.env.TELEGRAM_CHAT_ID;

    if (!TASKS_DB_ID || !PROJECTS_DB_ID) {
      const msg = '⚙️ <b>Planning Brief not configured.</b>\n\nRun /api/plan-setup first, then set:\n• NOTION_TASKS_DB_ID\n• NOTION_PROJECTS_DB_ID\nin your Vercel env vars.';
      if (TELEGRAM_BOT && TELEGRAM_CHAT) await sendTelegram(TELEGRAM_BOT, TELEGRAM_CHAT, msg);
      return res.status(200).json({ success: false, reason: 'DB IDs not set' });
    }

    const notionHeaders = {
      'Authorization': `Bearer ${NOTION_TOKEN}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28',
    };

    const now     = sgNow();
    const today   = isoDate(now);
    const tomorrow = isoDate(addDays(now, 1));
    const weekEnd  = isoDate(addDays(now, 7));

    // ── Query tasks ──────────────────────────────────────────────────────────
    const [overdueTasks, tomorrowTasks, weekTasks, activeProjects] = await Promise.all([
      queryDb(notionHeaders, TASKS_DB_ID, {
        and: [
          { property: 'Status', select: { does_not_equal: 'Done' } },
          { property: 'Due Date', date: { before: today } },
        ],
      }),
      queryDb(notionHeaders, TASKS_DB_ID, {
        and: [
          { property: 'Status', select: { does_not_equal: 'Done' } },
          { property: 'Due Date', date: { equals: tomorrow } },
        ],
      }),
      queryDb(notionHeaders, TASKS_DB_ID, {
        and: [
          { property: 'Status', select: { does_not_equal: 'Done' } },
          { property: 'Due Date', date: { after: tomorrow } },
          { property: 'Due Date', date: { on_or_before: weekEnd } },
        ],
      }),
      queryDb(notionHeaders, PROJECTS_DB_ID, {
        and: [
          { property: 'Status', select: { does_not_equal: 'Completed' } },
          { property: 'Due Date', date: { on_or_before: weekEnd } },
        ],
      }),
    ]);

    // ── Build context for AI ─────────────────────────────────────────────────
    const overdueLines   = overdueTasks.map(t => `- ${propTitle(t)} [due ${propDate(t)}]`).join('\n') || 'None';
    const tomorrowLines  = tomorrowTasks.map(t => `- ${propTitle(t)} [${propPriority(t)}]`).join('\n') || 'None';
    const weekLines      = weekTasks.map(t => `- ${propTitle(t)} [due ${propDate(t)}]`).join('\n') || 'None';
    const projectLines   = activeProjects.map(p => `- ${propTitle(p)} [${propStatus(p)}] due ${propDate(p)}`).join('\n') || 'None';

    // Merge tomorrow + week tasks for top-3 selection
    const candidateTasks = [...tomorrowTasks, ...weekTasks];

    // ── Groq AI brief ────────────────────────────────────────────────────────
    let aiTake = '';
    if (GROQ_API_KEY && candidateTasks.length + overdueTasks.length > 0) {
      const prompt = `You are Ooppyy, a sharp and witty Chief of Staff. Write a 1-2 sentence evening planning insight about tomorrow's priorities. Be direct, a little sarcastic, no fluff.\n\nTomorrow's tasks: ${tomorrowLines}\nOverdue: ${overdueLines}\nProjects: ${projectLines}\n\nRespond with plain text only, max 2 sentences.`;
      try {
        const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.6,
            max_tokens: 200,
          }),
        });
        const d = await r.json();
        if (r.ok) aiTake = d.choices[0].message.content.trim();
      } catch (e) {
        console.error('Groq error:', e.message);
      }
    }

    // ── Build Telegram message ───────────────────────────────────────────────
    const shortDate = now.toLocaleDateString('en-SG', {
      timeZone: 'Asia/Singapore', weekday: 'short', month: 'short', day: 'numeric',
    });

    // Top 3 priority tasks for tomorrow section
    const top3 = candidateTasks.slice(0, 3);

    let msg = `🌙 <b>Planning Brief · ${shortDate} · 9pm SGT</b>\n`;

    if (top3.length) {
      msg += `\n📌 <b>Tomorrow's Focus (top ${top3.length})</b>\n`;
      top3.forEach((t, i) => {
        const proj = t.properties?.Project?.rich_text?.[0]?.plain_text;
        const due  = propDate(t);
        msg += `${i + 1}. ${e(propTitle(t))}`;
        if (proj) msg += ` · ${e(proj)}`;
        if (due)  msg += ` · Due ${due}`;
        msg += '\n';
      });
    } else {
      msg += `\n📌 <b>Tomorrow's Focus</b>\nAll clear — nothing due tomorrow. 🎉\n`;
    }

    if (overdueTasks.length) {
      msg += `\n⚠️ <b>Overdue (${overdueTasks.length} items)</b>\n`;
      overdueTasks.slice(0, 5).forEach(t => {
        msg += `• ${e(propTitle(t))} was due ${propDate(t)}\n`;
      });
      if (overdueTasks.length > 5) msg += `  …and ${overdueTasks.length - 5} more\n`;
    }

    if (activeProjects.length) {
      msg += `\n📅 <b>This Week</b>\n`;
      activeProjects.slice(0, 4).forEach(p => {
        msg += `• ${e(propTitle(p))} due ${propDate(p)} — ${propStatus(p)}\n`;
      });
    }

    if (aiTake) {
      msg += `\n💡 <b>Ooppyy's Take</b>\n${e(aiTake)}\n`;
    }

    msg += `\n<a href="https://ooppyy-intel-agent.vercel.app/api/plan">Planning HQ →</a>`;

    // ── Send ─────────────────────────────────────────────────────────────────
    if (!TELEGRAM_BOT || !TELEGRAM_CHAT) {
      return res.status(200).json({ success: true, message: msg, note: 'Telegram not configured' });
    }

    await sendTelegram(TELEGRAM_BOT, TELEGRAM_CHAT, msg);
    return res.status(200).json({ success: true, sent: true });

  } catch (error) {
    console.error('plan-brief error:', error);
    return res.status(500).json({ error: error.message });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function e(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function sgNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Singapore' }));
}

function isoDate(d) { return d.toISOString().slice(0, 10); }

function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function propTitle(page) {
  const t = page.properties?.Name?.title;
  return t && t.length ? t[0].plain_text : '(untitled)';
}

function propStatus(page) { return page.properties?.Status?.select?.name || ''; }
function propDate(page)   { return page.properties?.['Due Date']?.date?.start || ''; }
function propPriority(page){ return page.properties?.Priority?.select?.name || ''; }

async function queryDb(notionHeaders, dbId, filter) {
  const r = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
    method: 'POST',
    headers: notionHeaders,
    body: JSON.stringify({ filter }),
  });
  const data = await r.json();
  if (!r.ok) {
    console.error('Notion query error:', JSON.stringify(data));
    return [];
  }
  return data.results || [];
}

async function sendTelegram(token, chatId, text) {
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  });
  if (!r.ok) console.error('Telegram error:', await r.text());
}
