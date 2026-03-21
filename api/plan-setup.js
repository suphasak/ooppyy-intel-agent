export default async function handler(req, res) {
  try {
    const NOTION_TOKEN = process.env.NOTION_TOKEN;
    const NOTION_PAGE_ID = process.env.NOTION_PAGE_ID;
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

    if (!NOTION_TOKEN || !NOTION_PAGE_ID) {
      return res.status(500).json({ error: 'NOTION_TOKEN and NOTION_PAGE_ID must be set.' });
    }

    const notionHeaders = {
      'Authorization': `Bearer ${NOTION_TOKEN}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28',
    };

    // ── 1. Create Planning HQ parent page ───────────────────────────────────
    const hqRes = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: notionHeaders,
      body: JSON.stringify({
        parent: { page_id: NOTION_PAGE_ID },
        properties: {
          title: { title: [{ text: { content: '🧠 Ooppyy Planning HQ' } }] },
        },
        children: [
          {
            object: 'block', type: 'callout',
            callout: {
              icon: { type: 'emoji', emoji: '🤖' },
              color: 'blue_background',
              rich_text: [{ type: 'text', text: { content: 'Planning HQ · Agent #0 — Ooppyy Planning Agent. Databases below are your goals, projects, and tasks. Interact via Telegram commands.' } }],
            },
          },
        ],
      }),
    });
    if (!hqRes.ok) {
      const err = await hqRes.json();
      throw new Error(`Failed to create Planning HQ page: ${JSON.stringify(err)}`);
    }
    const hqPage = await hqRes.json();
    const hqPageId = hqPage.id;
    const hqPageUrl = hqPage.url;

    // ── 2. Create Goals database ─────────────────────────────────────────────
    const goalsDbRes = await fetch('https://api.notion.com/v1/databases', {
      method: 'POST',
      headers: notionHeaders,
      body: JSON.stringify({
        parent: { type: 'page_id', page_id: hqPageId },
        title: [{ type: 'text', text: { content: '🎯 Goals' } }],
        properties: {
          Name: { title: {} },
          Quarter: {
            select: {
              options: [
                { name: 'Q1', color: 'blue' },
                { name: 'Q2', color: 'green' },
                { name: 'Q3', color: 'yellow' },
                { name: 'Q4', color: 'red' },
              ],
            },
          },
          Status: {
            select: {
              options: [
                { name: 'Active', color: 'blue' },
                { name: 'Completed', color: 'green' },
                { name: 'Paused', color: 'gray' },
              ],
            },
          },
          Priority: {
            select: {
              options: [
                { name: 'High', color: 'red' },
                { name: 'Medium', color: 'yellow' },
                { name: 'Low', color: 'gray' },
              ],
            },
          },
        },
      }),
    });
    if (!goalsDbRes.ok) {
      const err = await goalsDbRes.json();
      throw new Error(`Failed to create Goals DB: ${JSON.stringify(err)}`);
    }
    const goalsDb = await goalsDbRes.json();
    const goalsDbId = goalsDb.id;

    // ── 3. Create Projects database ──────────────────────────────────────────
    const projectsDbRes = await fetch('https://api.notion.com/v1/databases', {
      method: 'POST',
      headers: notionHeaders,
      body: JSON.stringify({
        parent: { type: 'page_id', page_id: hqPageId },
        title: [{ type: 'text', text: { content: '📁 Projects' } }],
        properties: {
          Name: { title: {} },
          Status: {
            select: {
              options: [
                { name: 'Planning', color: 'gray' },
                { name: 'Active', color: 'blue' },
                { name: 'On Hold', color: 'yellow' },
                { name: 'Completed', color: 'green' },
              ],
            },
          },
          'Due Date': { date: {} },
          Priority: {
            select: {
              options: [
                { name: 'High', color: 'red' },
                { name: 'Medium', color: 'yellow' },
                { name: 'Low', color: 'gray' },
              ],
            },
          },
          Goal: { rich_text: {} },
        },
      }),
    });
    if (!projectsDbRes.ok) {
      const err = await projectsDbRes.json();
      throw new Error(`Failed to create Projects DB: ${JSON.stringify(err)}`);
    }
    const projectsDb = await projectsDbRes.json();
    const projectsDbId = projectsDb.id;

    // ── 4. Create Tasks database ─────────────────────────────────────────────
    const tasksDbRes = await fetch('https://api.notion.com/v1/databases', {
      method: 'POST',
      headers: notionHeaders,
      body: JSON.stringify({
        parent: { type: 'page_id', page_id: hqPageId },
        title: [{ type: 'text', text: { content: '✅ Tasks' } }],
        properties: {
          Name: { title: {} },
          Status: {
            select: {
              options: [
                { name: 'Todo', color: 'gray' },
                { name: 'In Progress', color: 'blue' },
                { name: 'Done', color: 'green' },
                { name: 'Blocked', color: 'red' },
              ],
            },
          },
          'Due Date': { date: {} },
          Priority: {
            select: {
              options: [
                { name: 'High', color: 'red' },
                { name: 'Medium', color: 'yellow' },
                { name: 'Low', color: 'gray' },
              ],
            },
          },
          Project: { rich_text: {} },
          Notes: { rich_text: {} },
        },
      }),
    });
    if (!tasksDbRes.ok) {
      const err = await tasksDbRes.json();
      throw new Error(`Failed to create Tasks DB: ${JSON.stringify(err)}`);
    }
    const tasksDb = await tasksDbRes.json();
    const tasksDbId = tasksDb.id;

    // ── 5. Append DB IDs as a config block on the HQ page ───────────────────
    await fetch(`https://api.notion.com/v1/blocks/${hqPageId}/children`, {
      method: 'PATCH',
      headers: notionHeaders,
      body: JSON.stringify({
        children: [
          { object: 'block', type: 'divider', divider: {} },
          {
            object: 'block', type: 'heading_2',
            heading_2: { rich_text: [{ type: 'text', text: { content: '⚙️ Env Vars — copy these to Vercel' } }] },
          },
          {
            object: 'block', type: 'code',
            code: {
              language: 'bash',
              rich_text: [{
                type: 'text',
                text: {
                  content: `NOTION_PLANNING_PAGE_ID=${hqPageId}\nNOTION_GOALS_DB_ID=${goalsDbId}\nNOTION_PROJECTS_DB_ID=${projectsDbId}\nNOTION_TASKS_DB_ID=${tasksDbId}`,
                },
              }],
            },
          },
        ],
      }),
    });

    // ── 6. Register Telegram webhook ─────────────────────────────────────────
    let webhookStatus = 'skipped — TELEGRAM_BOT_TOKEN not set';
    if (TELEGRAM_BOT_TOKEN) {
      const webhookUrl = 'https://ooppyy-intel-agent.vercel.app/api/telegram-webhook';
      const wRes = await fetch(
        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: webhookUrl }),
        }
      );
      const wData = await wRes.json();
      webhookStatus = wData.ok ? `registered → ${webhookUrl}` : `error: ${JSON.stringify(wData)}`;
    }

    return res.status(200).json({
      success: true,
      message: '🧠 Planning HQ initialised. Copy the env vars below into Vercel, then redeploy.',
      notionHQ: { pageId: hqPageId, url: hqPageUrl },
      databases: {
        goals:    { id: goalsDbId,    url: goalsDb.url },
        projects: { id: projectsDbId, url: projectsDb.url },
        tasks:    { id: tasksDbId,    url: tasksDb.url },
      },
      envVarsToSet: {
        NOTION_PLANNING_PAGE_ID: hqPageId,
        NOTION_GOALS_DB_ID:      goalsDbId,
        NOTION_PROJECTS_DB_ID:   projectsDbId,
        NOTION_TASKS_DB_ID:      tasksDbId,
      },
      telegramWebhook: webhookStatus,
    });
  } catch (error) {
    console.error('plan-setup error:', error);
    return res.status(500).json({ error: error.message });
  }
}
