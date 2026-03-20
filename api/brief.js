export default async function handler(req, res) {
  try {
    const news = await fetchAllNews();
    const briefData = await generateBrief(news);
    await sendToTelegram(briefData);
    await saveToNotion(briefData);
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Brief error:', error);
    res.status(500).json({ error: error.message });
  }
}

const FEEDS = [
  { category: 'World & Politics', emoji: '🌍', url: 'https://feeds.bbci.co.uk/news/world/rss.xml', source: 'BBC World' },
  { category: 'Markets & Economics', emoji: '📈', url: 'https://feeds.bbci.co.uk/news/business/rss.xml', source: 'BBC Business' },
  { category: 'Technology & AI', emoji: '💻', url: 'https://feeds.bbci.co.uk/news/technology/rss.xml', source: 'BBC Tech' },
  { category: 'Technology & AI', emoji: '💻', url: 'https://techcrunch.com/feed/', source: 'TechCrunch' },
  { category: 'Fashion & Beauty', emoji: '👗', url: 'https://wwd.com/feed/', source: 'WWD' },
  { category: 'Fashion & Beauty', emoji: '👗', url: 'https://fashionunited.com/rss/news', source: 'FashionUnited' },
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
    const titleMatch = item.match(titleRegex);
    const descMatch = item.match(descRegex);
    const linkMatch = item.match(linkRegex);
    const title = titleMatch ? (titleMatch[1] || titleMatch[2] || '').trim() : '';
    const desc = descMatch ? (descMatch[1] || descMatch[2] || '').replace(/<[^>]+>/g, '').trim() : '';
    const link = linkMatch ? linkMatch[1].trim() : '';
    if (title && title.length > 5) {
      items.push({ title, description: desc.substring(0, 300), url: link, source: sourceName });
    }
  }
  return items.slice(0, 6);
}

async function fetchAllNews() {
  const results = {};
  await Promise.all(FEEDS.map(async (feed) => {
    try {
      const response = await fetch(feed.url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NewsBot/1.0)' },
        signal: AbortSignal.timeout(8000)
      });
      if (response.ok) {
        const xml = await response.text();
        const items = parseRSS(xml, feed.source);
        if (!results[feed.category]) results[feed.category] = { emoji: feed.emoji, items: [] };
        results[feed.category].items.push(...items);
      }
    } catch (e) {
      console.error(`Feed failed: ${feed.url}`);
    }
  }));
  return results;
}

async function generateBrief(news) {
  const date = new Date().toLocaleDateString('en-SG', {
    timeZone: 'Asia/Singapore',
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  let newsContext = '';
  for (const [category, { items }] of Object.entries(news)) {
    if (!items.length) continue;
    newsContext += `\n\n${category.toUpperCase()}:\n`;
    items.slice(0, 5).forEach((item, i) => {
      newsContext += `${i + 1}. ${item.title}\n`;
      if (item.url) newsContext += `   URL: ${item.url}\n`;
      if (item.description) newsContext += `   Context: ${item.description}\n`;
    });
  }

  const prompt = `You are Ooppyy, a sharp intelligence analyst with wit. Today is ${date}.

Headlines and URLs from RSS feeds:${newsContext}

Write a morning intel brief. Output in EXACTLY this format, no deviation:

WORLD & POLITICS 🌍
STORY: [headline in 1 sentence]
SOURCE: [paste the exact URL from above, or leave blank if none]
SOWHAT: [1-2 sentences — implication for fashion/beauty in SEA/India/GCC or AI consulting in Singapore]

STORY: [headline in 1 sentence]
SOURCE: [URL]
SOWHAT: [implication]

MARKETS & ECONOMICS 📈
STORY: [headline]
SOURCE: [URL]
SOWHAT: [implication]

STORY: [headline]
SOURCE: [URL]
SOWHAT: [implication]

TECHNOLOGY & AI 💻
STORY: [headline]
SOURCE: [URL]
SOWHAT: [implication]

STORY: [headline]
SOURCE: [URL]
SOWHAT: [implication]

FASHION & BEAUTY 👗
STORY: [headline]
SOURCE: [URL]
SOWHAT: [implication]

STORY: [headline]
SOURCE: [URL]
SOWHAT: [implication]

OPPORTUNITIES & THREATS 🎯
• [actionable item 1]
• [actionable item 2]
• [actionable item 3]

Reader: Fashion & beauty distributor in SEA/India/GCC. Building AI consulting agency in Singapore.
Use plain text only — no asterisks, no hashtags, no markdown symbols.`;

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.6,
      max_tokens: 2500
    })
  });

  const data = await response.json();
  if (!response.ok) throw new Error(`Groq error: ${JSON.stringify(data)}`);

  const rawText = data.choices[0].message.content;
  return { date, rawText, sections: parseBrief(rawText) };
}

function parseBrief(text) {
  const sectionDefs = [
    { key: 'world', label: 'WORLD & POLITICS', emoji: '🌍' },
    { key: 'markets', label: 'MARKETS & ECONOMICS', emoji: '📈' },
    { key: 'tech', label: 'TECHNOLOGY & AI', emoji: '💻' },
    { key: 'fashion', label: 'FASHION & BEAUTY', emoji: '👗' },
    { key: 'opportunities', label: 'OPPORTUNITIES & THREATS', emoji: '🎯' },
  ];

  const sections = {};
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  let currentSection = null;
  let currentStory = null;

  for (const line of lines) {
    const sectionMatch = sectionDefs.find(s => line.toUpperCase().includes(s.label));
    if (sectionMatch) {
      currentSection = sectionMatch.key;
      sections[currentSection] = { ...sectionMatch, stories: [], bullets: [] };
      currentStory = null;
      continue;
    }
    if (!currentSection) continue;

    if (line.startsWith('STORY:')) {
      currentStory = { headline: line.replace('STORY:', '').trim(), source: '', sowhat: '' };
      sections[currentSection].stories.push(currentStory);
    } else if (line.startsWith('SOURCE:') && currentStory) {
      currentStory.source = line.replace('SOURCE:', '').trim();
    } else if (line.startsWith('SOWHAT:') && currentStory) {
      currentStory.sowhat = line.replace('SOWHAT:', '').trim();
    } else if (line.startsWith('•') || line.startsWith('-')) {
      sections[currentSection].bullets.push(line.replace(/^[•\-]\s*/, ''));
    }
  }

  return sections;
}

function formatTelegramMessage(briefData) {
  const { date, sections } = briefData;
  const shortDate = new Date().toLocaleDateString('en-SG', {
    timeZone: 'Asia/Singapore', month: 'short', day: 'numeric'
  });

  let msg = `🌅 <b>OOPPYY INTEL BRIEF — ${shortDate}</b>\n`;
  msg += `─────────────────────────────\n\n`;

  const order = ['world', 'markets', 'tech', 'fashion'];
  for (const key of order) {
    const section = sections[key];
    if (!section || !section.stories.length) continue;
    msg += `${section.emoji} <b>${section.label}</b>\n\n`;
    for (const story of section.stories.slice(0, 2)) {
      msg += `📌 <b>${escapeHTML(story.headline)}</b>\n`;
      if (story.source && story.source.startsWith('http')) {
        msg += `🔗 <a href="${story.source}">Read source</a>\n`;
      }
      if (story.sowhat) {
        msg += `💡 <i>${escapeHTML(story.sowhat)}</i>\n`;
      }
      msg += '\n';
    }
  }

  const opp = sections['opportunities'];
  if (opp && opp.bullets.length) {
    msg += `🎯 <b>OPPORTUNITIES &amp; THREATS</b>\n`;
    opp.bullets.forEach(b => { msg += `• ${escapeHTML(b)}\n`; });
    msg += '\n';
  }

  msg += `─────────────────────────────\n`;
  msg += `📊 <a href="https://ooppyy-intel-agent.vercel.app/api/view">Open full brief in browser →</a>`;
  return msg;
}

function escapeHTML(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function splitMessage(text, maxLength) {
  if (text.length <= maxLength) return [text];
  const chunks = [];
  let current = '';
  for (const line of text.split('\n')) {
    if ((current + '\n' + line).length > maxLength) {
      chunks.push(current);
      current = line;
    } else {
      current = current ? current + '\n' + line : line;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

async function sendToTelegram(briefData) {
  const message = formatTelegramMessage(briefData);
  const chunks = splitMessage(message, 4000);
  for (const chunk of chunks) {
    const r = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: process.env.TELEGRAM_CHAT_ID,
        text: chunk,
        parse_mode: 'HTML',
        disable_web_page_preview: false
      })
    });
    if (!r.ok) {
      const err = await r.json();
      throw new Error(`Telegram error: ${JSON.stringify(err)}`);
    }
  }
}

async function saveToNotion(briefData) {
  const { date, rawText } = briefData;
  const lines = rawText.split('\n').filter(p => p.trim());
  const blocks = lines.map(line => ({
    object: 'block', type: 'paragraph',
    paragraph: { rich_text: [{ type: 'text', text: { content: line.substring(0, 2000) } }] }
  }));

  const r = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.NOTION_TOKEN}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28'
    },
    body: JSON.stringify({
      parent: { page_id: process.env.NOTION_PAGE_ID },
      properties: { title: { title: [{ text: { content: `📰 Intel Brief — ${date}` } }] } },
      children: blocks.slice(0, 100)
    })
  });

  if (!r.ok) {
    const err = await r.json();
    throw new Error(`Notion error: ${JSON.stringify(err)}`);
  }
}
