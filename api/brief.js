const AGENT_VERSION = '1.4';
const AGENT_NAME = 'Market Intelligence Agent';

export default async function handler(req, res) {
  try {
    const briefNum = await getNextBriefNumber();
    const news = await fetchAllNews();
    const briefData = await generateBrief(news, briefNum);
    await sendToTelegram(briefData);
    await saveToNotion(briefData);
    res.status(200).json({ success: true, brief: briefNum });
  } catch (error) {
    console.error('Brief error:', error);
    res.status(500).json({ error: error.message });
  }
}

async function getNextBriefNumber() {
  try {
    const r = await fetch(
      `https://api.notion.com/v1/blocks/${process.env.NOTION_PAGE_ID}/children?page_size=100`,
      { headers: { 'Authorization': `Bearer ${process.env.NOTION_TOKEN}`, 'Notion-Version': '2022-06-28' } }
    );
    const data = await r.json();
    const count = (data.results || []).filter(b => b.type === 'child_page').length;
    return count + 1;
  } catch { return 1; }
}

const FEEDS = [
  { category: 'WORLD & POLITICS', emoji: '🌍', url: 'https://feeds.bbci.co.uk/news/world/rss.xml', source: 'BBC World' },
  { category: 'MARKETS & ECONOMICS', emoji: '📈', url: 'https://feeds.bbci.co.uk/news/business/rss.xml', source: 'BBC Business' },
  { category: 'TECHNOLOGY & AI', emoji: '💻', url: 'https://feeds.bbci.co.uk/news/technology/rss.xml', source: 'BBC Tech' },
  { category: 'TECHNOLOGY & AI', emoji: '💻', url: 'https://techcrunch.com/feed/', source: 'TechCrunch' },
  { category: 'FASHION & BEAUTY', emoji: '👗', url: 'https://wwd.com/feed/', source: 'WWD' },
  { category: 'FASHION & BEAUTY', emoji: '👗', url: 'https://fashionunited.com/rss/news', source: 'FashionUnited' },
];

function parseRSS(xml, sourceName) {
  const items = [];
  const itemRegex = /<item[\s\S]*?<\/item>/g;
  const titleRegex = /<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>|<title>([^<]{3,})<\/title>/;
  const descRegex = /<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>|<description>([^<]{5,})<\/description>/;
  const linkRegex = /<link>(https?:\/\/[^<]+)<\/link>/;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const item = match[0];
    const t = item.match(titleRegex);
    const d = item.match(descRegex);
    const l = item.match(linkRegex);
    const title = t ? (t[1] || t[2] || '').trim() : '';
    const desc = d ? (d[1] || d[2] || '').replace(/<[^>]+>/g, '').trim() : '';
    const link = l ? l[1].trim() : '';
    if (title.length > 5) items.push({ title, description: desc.substring(0, 250), url: link, source: sourceName });
  }
  return items.slice(0, 5);
}

async function fetchAllNews() {
  const results = {};
  await Promise.all(FEEDS.map(async (feed) => {
    try {
      const r = await fetch(feed.url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NewsBot/1.0)' },
        signal: AbortSignal.timeout(8000)
      });
      if (r.ok) {
        const xml = await r.text();
        const items = parseRSS(xml, feed.source);
        if (!results[feed.category]) results[feed.category] = { emoji: feed.emoji, items: [] };
        results[feed.category].items.push(...items);
      }
    } catch (e) { /* feed failed, skip */ }
  }));
  return results;
}

async function generateBrief(news, briefNum) {
  const date = new Date().toLocaleDateString('en-SG', {
    timeZone: 'Asia/Singapore',
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  let newsContext = '';
  for (const [category, { items }] of Object.entries(news)) {
    if (!items.length) continue;
    newsContext += `\n\n${category}:\n`;
    items.slice(0, 4).forEach((item, i) => {
      newsContext += `${i + 1}. ${item.title}\n`;
      if (item.url) newsContext += `   URL: ${item.url}\n`;
      if (item.description) newsContext += `   Context: ${item.description}\n`;
    });
  }

  const prompt = `You are Ooppyy, a sharp intelligence analyst. Today is ${date}.

Here are today's headlines:${newsContext}

Output ONLY valid JSON (no markdown, no text before or after). Use exactly this structure:

{
  "date": "${date}",
  "sections": [
    {
      "key": "world",
      "label": "WORLD & POLITICS",
      "emoji": "🌍",
      "color": "#0ea5e9",
      "stories": [
        {
          "headline": "Story headline in 1 sentence",
          "source_url": "paste exact URL from above or empty string",
          "source_name": "Publication name",
          "sowhat": "ONE sentence — implication for fashion/beauty in SEA/India/GCC or AI consulting SG",
          "virality": 8
        }
      ]
    },
    {
      "key": "markets",
      "label": "MARKETS & ECONOMICS",
      "emoji": "📈",
      "color": "#22c55e",
      "stories": [{"headline":"...","source_url":"...","source_name":"...","sowhat":"...","virality":7}]
    },
    {
      "key": "tech",
      "label": "TECHNOLOGY & AI",
      "emoji": "💻",
      "color": "#a855f7",
      "stories": [{"headline":"...","source_url":"...","source_name":"...","sowhat":"...","virality":6}]
    },
    {
      "key": "fashion",
      "label": "FASHION & BEAUTY",
      "emoji": "👗",
      "color": "#ec4899",
      "stories": [{"headline":"...","source_url":"...","source_name":"...","sowhat":"...","virality":5}]
    }
  ],
  "opportunities": [
    "Actionable item #1 (max 12 words)",
    "Actionable item #2 (max 12 words)"
  ]
}

Rules:
- 2 stories per section (8 total)
- sowhat is ONE sentence max
- source_url must be a real URL from above, or ""
- virality 1-10: global impact + market relevance + how widely discussed today
- Output raw JSON only, nothing else`;

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.5,
      max_tokens: 3000,
      response_format: { type: 'json_object' }
    })
  });

  const data = await response.json();
  if (!response.ok) throw new Error(`Groq error: ${JSON.stringify(data)}`);

  let parsed;
  try {
    parsed = JSON.parse(data.choices[0].message.content);
  } catch (e) {
    throw new Error(`JSON parse failed: ${data.choices[0].message.content.substring(0, 200)}`);
  }

  parsed.briefNum = briefNum;
  parsed.agentVersion = AGENT_VERSION;
  parsed.agentName = AGENT_NAME;
  parsed.generatedAt = new Date().toISOString();
  parsed.sourcesUsed = ['BBC World', 'BBC Business', 'BBC Tech', 'TechCrunch', 'WWD', 'FashionUnited'];
  return parsed;
}

function escHTML(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function sendToTelegram(briefData) {
  const { sections = [], opportunities = [], briefNum } = briefData;
  const shortDate = new Date().toLocaleDateString('en-SG', {
    timeZone: 'Asia/Singapore', weekday: 'short', month: 'short', day: 'numeric'
  });

  // Flatten all stories, sort by virality score desc, take top 5
  const allStories = sections.flatMap(s =>
    (s.stories || []).map(story => ({ ...story, emoji: s.emoji }))
  ).sort((a, b) => (b.virality || 0) - (a.virality || 0)).slice(0, 5);

  let msg = `🌅 <b>Brief #${briefNum || '?'} · ${shortDate}</b>\n\n`;

  for (const story of allStories) {
    const viralityBar = '🔥'.repeat(Math.round((story.virality || 5) / 3));
    msg += `${story.emoji} <b>${escHTML(story.headline)}</b>\n`;
    msg += `↳ ${escHTML(story.sowhat)}`;
    if (story.source_url) msg += ` <a href="${story.source_url}">↗</a>`;
    msg += ` ${viralityBar}\n\n`;
  }

  if (opportunities?.length) {
    msg += `🎯 ${escHTML(opportunities[0])}\n`;
    if (opportunities[1]) msg += `🎯 ${escHTML(opportunities[1])}\n`;
    msg += '\n';
  }

  msg += `<a href="https://ooppyy-intel-agent.vercel.app/api/view">Full brief →</a>`;

  const r = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: process.env.TELEGRAM_CHAT_ID,
      text: msg,
      parse_mode: 'HTML',
      disable_web_page_preview: true
    })
  });
  if (!r.ok) {
    const err = await r.json();
    throw new Error(`Telegram error: ${JSON.stringify(err)}`);
  }
}

async function saveToNotion(briefData) {
  const { date, briefNum, agentVersion, agentName, generatedAt, sourcesUsed, sections = [], opportunities = [] } = briefData;

  const storiesCount = sections.reduce((n, s) => n + (s.stories || []).length, 0);
  const sgTime = new Date(generatedAt).toLocaleString('en-SG', { timeZone: 'Asia/Singapore', hour: '2-digit', minute: '2-digit' });

  // Split JSON into 1900-char chunks for code blocks
  const jsonStr = JSON.stringify(briefData);
  const jsonChunks = [];
  for (let i = 0; i < jsonStr.length; i += 1900) jsonChunks.push(jsonStr.slice(i, i + 1900));

  const metadataRow = (label, value) => ({
    object: 'block', type: 'paragraph',
    paragraph: { rich_text: [
      { type: 'text', text: { content: `${label}  ` }, annotations: { bold: true } },
      { type: 'text', text: { content: value } }
    ]}
  });

  const blocks = [
    // ── METADATA CALLOUT (PM at-a-glance) ──
    {
      object: 'block', type: 'callout',
      callout: {
        icon: { type: 'emoji', emoji: '📋' },
        color: 'blue_background',
        rich_text: [{ type: 'text', text: { content: `Brief #${briefNum}  ·  Agent ${agentName} v${agentVersion}  ·  ${storiesCount} stories  ·  ${sourcesUsed.length} sources  ·  Generated ${sgTime} SGT` } }]
      }
    },
    metadataRow('📅 Date:', date),
    metadataRow('🔢 Brief #:', `${briefNum}`),
    metadataRow('🤖 Agent Version:', `v${agentVersion}`),
    metadataRow('📰 Sources:', sourcesUsed.join(', ')),
    metadataRow('📊 Stories covered:', `${storiesCount} across ${sections.length} sections`),
    metadataRow('🌐 HTML View:', `https://ooppyy-intel-agent.vercel.app/api/view`),
    { object: 'block', type: 'divider', divider: {} },

    // ── JSON DATA (for view.js) ──
    ...jsonChunks.map(chunk => ({
      object: 'block', type: 'code',
      code: { language: 'json', rich_text: [{ type: 'text', text: { content: chunk } }] }
    })),
    { object: 'block', type: 'divider', divider: {} },

    // ── HUMAN-READABLE SECTIONS ──
    ...sections.flatMap(section => [
      {
        object: 'block', type: 'heading_2',
        heading_2: { rich_text: [{ type: 'text', text: { content: `${section.emoji} ${section.label}` } }] }
      },
      ...(section.stories || []).flatMap(story => [
        {
          object: 'block', type: 'paragraph',
          paragraph: { rich_text: [{ type: 'text', text: { content: `📌 ${story.headline}` }, annotations: { bold: true } }] }
        },
        ...(story.source_url ? [{
          object: 'block', type: 'paragraph',
          paragraph: { rich_text: [{ type: 'text', text: { content: `🔗 Source: ${story.source_name || ''} — ${story.source_url}` }, annotations: { color: 'blue' } }] }
        }] : []),
        {
          object: 'block', type: 'quote',
          quote: { rich_text: [{ type: 'text', text: { content: `💡 So What: ${story.sowhat}` } }] }
        }
      ])
    ]),

    // ── OPPORTUNITIES ──
    ...(opportunities.length ? [
      { object: 'block', type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: '🎯 Opportunities & Threats' } }] } },
      ...opportunities.map(o => ({
        object: 'block', type: 'bulleted_list_item',
        bulleted_list_item: { rich_text: [{ type: 'text', text: { content: o } }] }
      }))
    ] : [])
  ];

  const r = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.NOTION_TOKEN}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28'
    },
    body: JSON.stringify({
      parent: { page_id: process.env.NOTION_PAGE_ID },
      properties: { title: { title: [{ text: { content: `📰 Brief #${briefNum} — ${date} [Agent v${agentVersion}]` } }] } },
      children: blocks.slice(0, 100)
    })
  });

  if (!r.ok) {
    const err = await r.json();
    throw new Error(`Notion error: ${JSON.stringify(err)}`);
  }
}
