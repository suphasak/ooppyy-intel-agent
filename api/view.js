export default async function handler(req, res) {
  try {
    // Get all child pages from main Intel Briefs Notion page
    const r = await fetch(
      `https://api.notion.com/v1/blocks/${process.env.NOTION_PAGE_ID}/children?page_size=100`,
      {
        headers: {
          'Authorization': `Bearer ${process.env.NOTION_TOKEN}`,
          'Notion-Version': '2022-06-28'
        }
      }
    );
    const data = await r.json();
    if (!r.ok) throw new Error(`Notion error: ${JSON.stringify(data)}`);

    const childPages = data.results.filter(b => b.type === 'child_page');
    if (!childPages.length) {
      return res.setHeader('Content-Type', 'text/html').status(200).send(emptyPage());
    }

    // Get the most recent brief page
    const latest = childPages[childPages.length - 1];
    const title = latest.child_page.title;

    // Fetch its content blocks
    const blocksR = await fetch(
      `https://api.notion.com/v1/blocks/${latest.id}/children?page_size=100`,
      {
        headers: {
          'Authorization': `Bearer ${process.env.NOTION_TOKEN}`,
          'Notion-Version': '2022-06-28'
        }
      }
    );
    const blocksData = await blocksR.json();
    if (!blocksR.ok) throw new Error(`Blocks error`);

    const lines = blocksData.results
      .filter(b => b.type === 'paragraph')
      .map(b => b.paragraph.rich_text.map(t => t.plain_text).join(''))
      .filter(l => l.trim());

    const html = renderBriefHTML(title, lines);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.status(200).send(html);
  } catch (error) {
    res.status(500).setHeader('Content-Type', 'text/html').send(`
      <html><body style="background:#0a0a0a;color:#fff;font-family:sans-serif;padding:2rem">
        <h2>⚠️ Error loading brief</h2><pre>${error.message}</pre>
      </body></html>`);
  }
}

function renderBriefHTML(title, lines) {
  const sections = parseSections(lines);
  const dateStr = title.replace('📰 Intel Brief — ', '');

  const sectionColors = {
    'WORLD & POLITICS': '#3b82f6',
    'MARKETS & ECONOMICS': '#10b981',
    'TECHNOLOGY & AI': '#8b5cf6',
    'FASHION & BEAUTY': '#f43f5e',
    'OPPORTUNITIES & THREATS': '#f59e0b',
  };

  const sectionsHTML = sections.map(section => {
    const color = sectionColors[section.label] || '#6b7280';
    const storiesHTML = section.stories.map(story => `
      <div class="story-card">
        <div class="story-headline">📌 ${esc(story.headline)}</div>
        ${story.source ? `<a href="${esc(story.source)}" target="_blank" class="source-link">🔗 View Source</a>` : ''}
        ${story.sowhat ? `<div class="sowhat-box"><span class="sowhat-label">💡 So What</span>${esc(story.sowhat)}</div>` : ''}
      </div>`).join('');

    const bulletsHTML = section.bullets.map(b =>
      `<div class="bullet">• ${esc(b)}</div>`
    ).join('');

    return `
      <div class="section" style="border-left-color: ${color}">
        <div class="section-header" style="color: ${color}">${section.emoji} ${section.label}</div>
        ${storiesHTML}${bulletsHTML}
      </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ooppyy Intel Brief — ${esc(dateStr)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #080810;
      color: #e2e8f0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      min-height: 100vh;
      padding: 1rem;
    }
    .container { max-width: 780px; margin: 0 auto; padding: 1.5rem 0 4rem; }
    .header {
      text-align: center;
      padding: 2.5rem 1.5rem 2rem;
      margin-bottom: 2rem;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      border-radius: 16px;
      border: 1px solid #1e293b;
    }
    .header-badge {
      display: inline-block;
      background: linear-gradient(90deg, #f59e0b, #ef4444);
      color: #000;
      font-weight: 800;
      font-size: 0.7rem;
      letter-spacing: 0.15em;
      padding: 0.3rem 0.8rem;
      border-radius: 999px;
      margin-bottom: 1rem;
      text-transform: uppercase;
    }
    .header h1 {
      font-size: clamp(1.4rem, 4vw, 2rem);
      font-weight: 800;
      color: #f8fafc;
      margin-bottom: 0.5rem;
      line-height: 1.2;
    }
    .header .date { color: #94a3b8; font-size: 0.95rem; }
    .section {
      background: #0f0f1a;
      border: 1px solid #1e293b;
      border-left: 4px solid;
      border-radius: 12px;
      padding: 1.5rem;
      margin-bottom: 1.25rem;
    }
    .section-header {
      font-size: 0.8rem;
      font-weight: 800;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      margin-bottom: 1.25rem;
      padding-bottom: 0.75rem;
      border-bottom: 1px solid #1e293b;
    }
    .story-card {
      margin-bottom: 1.25rem;
      padding-bottom: 1.25rem;
      border-bottom: 1px solid #1e293b;
    }
    .story-card:last-child { border-bottom: none; margin-bottom: 0; padding-bottom: 0; }
    .story-headline {
      font-size: 0.98rem;
      font-weight: 600;
      color: #f1f5f9;
      line-height: 1.5;
      margin-bottom: 0.5rem;
    }
    .source-link {
      display: inline-block;
      font-size: 0.78rem;
      color: #60a5fa;
      text-decoration: none;
      background: rgba(96, 165, 250, 0.1);
      padding: 0.2rem 0.6rem;
      border-radius: 999px;
      margin-bottom: 0.6rem;
      border: 1px solid rgba(96, 165, 250, 0.2);
    }
    .source-link:hover { background: rgba(96, 165, 250, 0.2); }
    .sowhat-box {
      background: rgba(255,255,255,0.03);
      border: 1px solid #1e293b;
      border-radius: 8px;
      padding: 0.75rem 1rem;
      font-size: 0.88rem;
      color: #94a3b8;
      line-height: 1.6;
    }
    .sowhat-label {
      display: block;
      font-size: 0.72rem;
      font-weight: 700;
      color: #f59e0b;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      margin-bottom: 0.4rem;
    }
    .bullet {
      font-size: 0.92rem;
      color: #cbd5e1;
      line-height: 1.7;
      padding: 0.25rem 0;
    }
    .footer {
      text-align: center;
      color: #475569;
      font-size: 0.8rem;
      margin-top: 2.5rem;
      padding-top: 1.5rem;
      border-top: 1px solid #1e293b;
    }
    @media (max-width: 600px) {
      body { padding: 0.5rem; }
      .section { padding: 1.1rem; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="header-badge">🤖 Ooppyy Intelligence</div>
      <h1>Daily Intel Brief</h1>
      <div class="date">📅 ${esc(dateStr)}</div>
    </div>
    ${sectionsHTML}
    <div class="footer">Generated by Ooppyy • Your AI Chief of Staff</div>
  </div>
</body>
</html>`;
}

function parseSections(lines) {
  const sectionDefs = [
    { label: 'WORLD & POLITICS', emoji: '🌍' },
    { label: 'MARKETS & ECONOMICS', emoji: '📈' },
    { label: 'TECHNOLOGY & AI', emoji: '💻' },
    { label: 'FASHION & BEAUTY', emoji: '👗' },
    { label: 'OPPORTUNITIES & THREATS', emoji: '🎯' },
  ];

  const sections = [];
  let current = null;
  let currentStory = null;

  for (const line of lines) {
    const sectionMatch = sectionDefs.find(s => line.toUpperCase().includes(s.label));
    if (sectionMatch) {
      current = { ...sectionMatch, stories: [], bullets: [] };
      sections.push(current);
      currentStory = null;
      continue;
    }
    if (!current) continue;

    if (line.startsWith('STORY:')) {
      currentStory = { headline: line.replace('STORY:', '').trim(), source: '', sowhat: '' };
      current.stories.push(currentStory);
    } else if (line.startsWith('SOURCE:') && currentStory) {
      const url = line.replace('SOURCE:', '').trim();
      if (url.startsWith('http')) currentStory.source = url;
    } else if (line.startsWith('SOWHAT:') && currentStory) {
      currentStory.sowhat = line.replace('SOWHAT:', '').trim();
    } else if ((line.startsWith('•') || line.startsWith('-')) && current) {
      current.bullets.push(line.replace(/^[•\-]\s*/, ''));
    }
  }
  return sections;
}

function esc(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function emptyPage() {
  return `<!DOCTYPE html><html><body style="background:#080810;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;text-align:center">
    <div><h2>No briefs yet 🌙</h2><p style="color:#64748b;margin-top:0.5rem">Check back tomorrow morning!</p></div>
  </body></html>`;
}
