export default async function handler(req, res) {
  try {
    const NOTION_TOKEN      = process.env.NOTION_TOKEN;
    const MISSION_PAGE_ID   = process.env.NOTION_MISSION_PAGE_ID;
    const GOALS_DB_ID       = process.env.NOTION_GOALS_DB_ID;
    const TASKS_DB_ID       = process.env.NOTION_TASKS_DB_ID;
    const GROQ_API_KEY      = process.env.GROQ_API_KEY;
    const TELEGRAM_BOT      = process.env.TELEGRAM_BOT_TOKEN;
    const TELEGRAM_CHAT     = process.env.TELEGRAM_CHAT_ID;

    const notionHeaders = {
      'Authorization': `Bearer ${NOTION_TOKEN}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28',
    };

    const now      = sgNow();
    const today    = isoDate(now);
    const shortDate = now.toLocaleDateString('en-SG', {
      timeZone: 'Asia/Singapore', weekday: 'short', month: 'short', day: 'numeric',
    });

    // ── 0. Fetch mission ─────────────────────────────────────────────────────
    let mission = '';
    if (NOTION_TOKEN && MISSION_PAGE_ID) {
      try {
        const mRes = await fetch(`https://api.notion.com/v1/pages/${MISSION_PAGE_ID}`, {
          headers: notionHeaders,
        });
        if (mRes.ok) {
          const mData = await mRes.json();
          mission = mData.properties?.title?.title?.[0]?.plain_text || '';
        }
      } catch (err) {
        console.error('Mission fetch error:', err.message);
      }
    }

    // ── Handle missing DB config ─────────────────────────────────────────────
    if (!GOALS_DB_ID || !TASKS_DB_ID) {
      const msg = '⚙️ <b>Morning Brief not configured.</b>\n\nRun /api/plan-setup first, then set:\n• NOTION_GOALS_DB_ID\n• NOTION_TASKS_DB_ID\nin your Vercel env vars.';
      if (TELEGRAM_BOT && TELEGRAM_CHAT) await sendTelegram(TELEGRAM_BOT, TELEGRAM_CHAT, msg);
      return res.status(200).json({ success: false, reason: 'DB IDs not set' });
    }

    // ── 1. Fetch active goals ────────────────────────────────────────────────
    const activeGoals = await queryDb(notionHeaders, GOALS_DB_ID, {
      property: 'Status', select: { does_not_equal: 'Completed' },
    });

    // ── 2. Fetch today's tasks (due today or overdue, not done) ──────────────
    const todayTasks = await queryDb(notionHeaders, TASKS_DB_ID, {
      and: [
        { property: 'Status', select: { does_not_equal: 'Done' } },
        { property: 'Due Date', date: { on_or_before: today } },
      ],
    });

    // ── 3. Groq: morning priorities ──────────────────────────────────────────
    let aiPriorities = '';
    if (GROQ_API_KEY && (todayTasks.length > 0 || activeGoals.length > 0)) {
      const goalLines = activeGoals.map(g => `- ${propTitle(g)} [${propStatus(g)}]`).join('\n') || 'None';
      const taskLines = todayTasks.map(t => `- ${propTitle(t)} [due ${propDate(t)}]`).join('\n') || 'None';

      const prompt = `You are Ooppyy, a sharp and witty Chief of Staff. Give the top 3 focus items for today, mission-aligned. Be direct, a little sarcastic, no fluff.\n\nMission: "${mission || 'Not set yet'}"\nActive goals:\n${goalLines}\nToday's tasks:\n${taskLines}\n\nRespond with plain text only, max 3 sentences.`;

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
        if (r.ok) aiPriorities = d.choices[0].message.content.trim();
      } catch (err) {
        console.error('Groq error:', err.message);
      }
    }

    // ── 4. Build Telegram message ────────────────────────────────────────────
    if (todayTasks.length === 0 && activeGoals.length === 0) {
      const msg = `☀️ Clean slate today! Set your mission and goals via Telegram. <a href="https://ooppyy-intel-agent.vercel.app/api/plan">Planning HQ →</a>`;
      if (!TELEGRAM_BOT || !TELEGRAM_CHAT) {
        return res.status(200).json({ success: true, message: msg, note: 'Telegram not configured' });
      }
      await sendTelegram(TELEGRAM_BOT, TELEGRAM_CHAT, msg);
      return res.status(200).json({ success: true, sent: true });
    }

    let msg = `☀️ <b>Morning OS Brief · ${shortDate} · 7:30am</b>\n`;

    if (mission) {
      msg += `\n🎯 <b>Mission</b>\n${e(mission)}\n`;
    }

    if (aiPriorities) {
      msg += `\n🏃 <b>Today's Focus</b>\n${e(aiPriorities)}\n`;
    }

    if (todayTasks.length) {
      msg += `\n📌 <b>Due Today (${todayTasks.length} tasks)</b>\n`;
      todayTasks.slice(0, 8).forEach((t, i) => {
        const code = propCode(t);
        const due  = propDate(t);
        msg += `${i + 1}. ${code ? code + ' · ' : ''}${e(propTitle(t))}`;
        if (due && due < today) msg += ` · ${due}`;
        msg += '\n';
      });
      if (todayTasks.length > 8) msg += `  …and ${todayTasks.length - 8} more\n`;
    }

    if (activeGoals.length) {
      msg += `\n🎯 <b>Active Goals (${activeGoals.length})</b>\n`;
      activeGoals.slice(0, 6).forEach(g => {
        const code    = propCode(g);
        const quarter = g.properties?.Quarter?.select?.name || '';
        const status  = propStatus(g);
        msg += `• ${code ? code + ' · ' : ''}${e(propTitle(g))}`;
        if (quarter) msg += ` · ${quarter}`;
        if (status)  msg += ` · ${status}`;
        msg += '\n';
      });
      if (activeGoals.length > 6) msg += `  …and ${activeGoals.length - 6} more\n`;
    }

    msg += `\n<a href="https://ooppyy-intel-agent.vercel.app/api/plan">Planning HQ →</a>`;

    // ── 5. Send ───────────────────────────────────────────────────────────────
    if (!TELEGRAM_BOT || !TELEGRAM_CHAT) {
      return res.status(200).json({ success: true, message: msg, note: 'Telegram not configured' });
    }

    await sendTelegram(TELEGRAM_BOT, TELEGRAM_CHAT, msg);
    return res.status(200).json({ success: true, sent: true });

  } catch (error) {
    console.error('morning-brief error:', error);
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

function propTitle(page) {
  const t = page.properties?.Name?.title;
  return t && t.length ? t[0].plain_text : '(untitled)';
}

function propStatus(page) { return page.properties?.Status?.select?.name || ''; }
function propDate(page)   { return page.properties?.['Due Date']?.date?.start || ''; }
function propCode(page)   { return page.properties?.Code?.rich_text?.[0]?.plain_text || ''; }

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
