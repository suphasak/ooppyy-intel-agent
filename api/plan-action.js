function parseCookies(str) {
  const out = {};
  for (const part of (str || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k) out[decodeURIComponent(k.trim())] = decodeURIComponent(v.join('=').trim());
  }
  return out;
}

const NOTION_HEADERS = () => ({
  'Authorization': `Bearer ${process.env.NOTION_TOKEN}`,
  'Content-Type': 'application/json',
  'Notion-Version': '2022-06-28',
});

async function getNextCode(dbId, prefix) {
  const r = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
    method: 'POST', headers: NOTION_HEADERS(), body: JSON.stringify({}),
  });
  const data = await r.json();
  const pages = data.results || [];
  let max = 0;
  for (const p of pages) {
    const code = p.properties?.Code?.rich_text?.[0]?.plain_text || '';
    if (code.startsWith(prefix)) {
      const n = parseInt(code.slice(prefix.length), 10);
      if (!isNaN(n) && n > max) max = n;
    }
  }
  return `${prefix}${max + 1}`;
}

async function patchPage(pageId, properties) {
  const r = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: 'PATCH', headers: NOTION_HEADERS(),
    body: JSON.stringify({ properties }),
  });
  return r.json();
}

async function createPage(dbId, properties) {
  const r = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST', headers: NOTION_HEADERS(),
    body: JSON.stringify({ parent: { database_id: dbId }, properties }),
  });
  return r.json();
}

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  // Auth: check ooppyy_plan cookie
  const cookies = parseCookies(req.headers.cookie);
  if (cookies['ooppyy_plan'] !== process.env.PLAN_SECRET) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  const { action, pageId, status, name, dueDate, projectName, goalName, quarter } = req.body || {};

  if (!action) {
    return res.status(400).json({ success: false, error: 'Missing action' });
  }

  try {
    let data;

    switch (action) {
      case 'mark-done': {
        if (!pageId) return res.status(400).json({ success: false, error: 'Missing pageId' });
        data = await patchPage(pageId, {
          Status: { select: { name: 'Done' } },
        });
        break;
      }

      case 'update-status': {
        if (!pageId) return res.status(400).json({ success: false, error: 'Missing pageId' });
        if (!status) return res.status(400).json({ success: false, error: 'Missing status' });
        data = await patchPage(pageId, {
          Status: { select: { name: status } },
        });
        break;
      }

      case 'archive': {
        if (!pageId) return res.status(400).json({ success: false, error: 'Missing pageId' });
        const r = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
          method: 'PATCH', headers: NOTION_HEADERS(),
          body: JSON.stringify({ archived: true }),
        });
        data = await r.json();
        break;
      }

      case 'create-task': {
        if (!name) return res.status(400).json({ success: false, error: 'Missing name' });
        const dbId = process.env.NOTION_TASKS_DB_ID;
        const code = await getNextCode(dbId, 'T');
        const properties = {
          Code: { rich_text: [{ text: { content: code } }] },
          Name: { title: [{ text: { content: name } }] },
          Status: { status: { name: 'Todo' } },
          Priority: { select: { name: 'Medium' } },
        };
        if (dueDate) {
          properties['Due Date'] = { date: { start: dueDate } };
        }
        if (projectName) {
          properties['Project'] = { rich_text: [{ text: { content: projectName } }] };
        }
        data = await createPage(dbId, properties);
        break;
      }

      case 'create-project': {
        if (!name) return res.status(400).json({ success: false, error: 'Missing name' });
        const dbId = process.env.NOTION_PROJECTS_DB_ID;
        const code = await getNextCode(dbId, 'P');
        const properties = {
          Code: { rich_text: [{ text: { content: code } }] },
          Name: { title: [{ text: { content: name } }] },
          Status: { status: { name: 'Planning' } },
          Priority: { select: { name: 'Medium' } },
        };
        if (dueDate) {
          properties['Due Date'] = { date: { start: dueDate } };
        }
        if (goalName) {
          properties['Goal'] = { rich_text: [{ text: { content: goalName } }] };
        }
        data = await createPage(dbId, properties);
        break;
      }

      case 'create-goal': {
        if (!name) return res.status(400).json({ success: false, error: 'Missing name' });
        const dbId = process.env.NOTION_GOALS_DB_ID;
        const code = await getNextCode(dbId, 'G');
        const properties = {
          Code: { rich_text: [{ text: { content: code } }] },
          Name: { title: [{ text: { content: name } }] },
          Status: { status: { name: 'Active' } },
          Priority: { select: { name: 'High' } },
        };
        if (quarter) {
          properties['Quarter'] = { rich_text: [{ text: { content: quarter } }] };
        }
        data = await createPage(dbId, properties);
        break;
      }

      default:
        return res.status(400).json({ success: false, error: `Unknown action: ${action}` });
    }

    return res.status(200).json({ success: true, data });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message || 'Internal server error' });
  }
}
