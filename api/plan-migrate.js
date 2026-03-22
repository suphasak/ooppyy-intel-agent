// One-time migration: backfill G#/P# codes on existing goals/projects,
// and archive (delete) all existing tasks.

const NOTION_HEADERS = () => ({
  'Authorization': `Bearer ${process.env.NOTION_TOKEN}`,
  'Content-Type': 'application/json',
  'Notion-Version': '2022-06-28',
});

async function queryAll(dbId) {
  const results = [];
  let cursor;
  do {
    const body = cursor ? { start_cursor: cursor } : {};
    const r = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
      method: 'POST',
      headers: NOTION_HEADERS(),
      body: JSON.stringify(body),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(`Notion query error: ${JSON.stringify(data)}`);
    results.push(...(data.results || []));
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);
  return results;
}

async function patchPage(pageId, properties) {
  const r = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: 'PATCH',
    headers: NOTION_HEADERS(),
    body: JSON.stringify({ properties }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`Notion patch error: ${JSON.stringify(data)}`);
  return data;
}

async function archivePage(pageId) {
  const r = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: 'PATCH',
    headers: NOTION_HEADERS(),
    body: JSON.stringify({ archived: true }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`Notion archive error: ${JSON.stringify(data)}`);
  return data;
}

function propCode(page) {
  return page.properties?.Code?.rich_text?.[0]?.plain_text || '';
}

async function ensureCodeProperty(dbId) {
  // Add Code rich_text property to the database schema if missing
  const r = await fetch(`https://api.notion.com/v1/databases/${dbId}`, {
    method: 'PATCH',
    headers: NOTION_HEADERS(),
    body: JSON.stringify({ properties: { Code: { rich_text: {} } } }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`Failed to add Code property: ${JSON.stringify(data)}`);
}

export default async function handler(req, res) {
  const { goals: goalsDbId, projects: projectsDbId, tasks: tasksDbId } = {
    goals:    process.env.NOTION_GOALS_DB_ID,
    projects: process.env.NOTION_PROJECTS_DB_ID,
    tasks:    process.env.NOTION_TASKS_DB_ID,
  };

  if (!goalsDbId || !projectsDbId || !tasksDbId) {
    return res.status(500).json({ error: 'Missing DB env vars. Run /api/plan-setup first.' });
  }

  const report = { goals: [], projects: [], tasksDeleted: 0, errors: [] };

  // ── 0. Ensure Code property exists on Goals + Projects DBs ────────────────
  try {
    await Promise.all([
      ensureCodeProperty(goalsDbId),
      ensureCodeProperty(projectsDbId),
    ]);
  } catch (e) {
    report.errors.push(`Schema update: ${e.message}`);
  }

  // ── 1. Backfill Goals ─────────────────────────────────────────────────────
  try {
    const goals = await queryAll(goalsDbId);
    // Pages without a Code value, sorted by creation time (default Notion order)
    const uncodedGoals = goals.filter(p => !propCode(p));

    // Find current max G# so we don't collide with any that already have codes
    let maxG = 0;
    for (const p of goals) {
      const c = propCode(p);
      if (c.startsWith('G')) {
        const n = parseInt(c.slice(1), 10);
        if (!isNaN(n) && n > maxG) maxG = n;
      }
    }

    for (const page of uncodedGoals) {
      maxG++;
      const code = `G${maxG}`;
      await patchPage(page.id, { Code: { rich_text: [{ text: { content: code } }] } });
      const name = page.properties?.Name?.title?.[0]?.plain_text || '(untitled)';
      report.goals.push(`${code} → ${name}`);
    }
  } catch (e) {
    report.errors.push(`Goals: ${e.message}`);
  }

  // ── 2. Backfill Projects ──────────────────────────────────────────────────
  try {
    const projects = await queryAll(projectsDbId);
    const uncodedProjects = projects.filter(p => !propCode(p));

    let maxP = 0;
    for (const p of projects) {
      const c = propCode(p);
      if (c.startsWith('P')) {
        const n = parseInt(c.slice(1), 10);
        if (!isNaN(n) && n > maxP) maxP = n;
      }
    }

    for (const page of uncodedProjects) {
      maxP++;
      const code = `P${maxP}`;
      await patchPage(page.id, { Code: { rich_text: [{ text: { content: code } }] } });
      const name = page.properties?.Name?.title?.[0]?.plain_text || '(untitled)';
      report.projects.push(`${code} → ${name}`);
    }
  } catch (e) {
    report.errors.push(`Projects: ${e.message}`);
  }

  // ── 3. Archive (delete) all Tasks ─────────────────────────────────────────
  try {
    const tasks = await queryAll(tasksDbId);
    for (const page of tasks) {
      await archivePage(page.id);
      report.tasksDeleted++;
    }
  } catch (e) {
    report.errors.push(`Tasks: ${e.message}`);
  }

  return res.status(200).json({
    success: report.errors.length === 0,
    summary: {
      goalsCoded: report.goals.length,
      projectsCoded: report.projects.length,
      tasksDeleted: report.tasksDeleted,
    },
    details: report,
  });
}
