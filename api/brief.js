export default async function handler(req, res) {
  try {
    const news = await fetchAllNews();
    const brief = await generateBrief(news);
    await sendToTelegram(brief);
    await saveToNotion(brief);
    res.status(200).json({ success: true, message: 'Intel brief sent!' });
  } catch (error) {
    console.error('Ooppyy brief error:', error);
    res.status(500).json({ error: error.message });
  }
}

// Free RSS news feeds — no API key needed
const FEEDS = [
  { category: 'World & Politics', url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
  { category: 'Markets & Economics', url: 'https://feeds.bbci.co.uk/news/business/rss.xml' },
  { category: 'Technology & AI', url: 'https://feeds.bbci.co.uk/news/technology/rss.xml' },
  { category: 'Technology & AI', url: 'https://techcrunch.com/feed/' },
  { category: 'Fashion & Beauty', url: 'https://wwd.com/feed/' },
  { category: 'Fashion & Beauty', url: 'https://fashionunited.com/rss/news' },
];

function parseRSS(xml) {
  const items = [];
  const itemRegex = /<item[\s\S]*?<\/item>/g;
  const titleRegex = /<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>|<title>([^<]*)<\/title>/;
  const descRegex = /<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>|<description>([^<]*)<\/description>/;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const item = match[0];
    const titleMatch = item.match(titleRegex);
    const descMatch = item.match(descRegex);
    const title = titleMatch ? (titleMatch[1] || titleMatch[2] || '').trim() : '';
    const desc = descMatch ? (descMatch[1] || descMatch[2] || '').replace(/<[^>]+>/g, '').trim() : '';
    if (title && title.length > 5) items.push({ title, description: desc.substring(0, 200) });
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
        const items = parseRSS(xml);
        if (!results[feed.category]) results[feed.category] = [];
        results[feed.category].push(...items);
      }
    } catch (e) {
      console.error(`Feed failed: ${feed.url} — ${e.message}`);
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
  for (const [category, items] of Object.entries(news)) {
    if (items.length === 0) continue;
    newsContext += `\n${category.toUpperCase()}:\n`;
    items.slice(0, 5).forEach((item, i) => {
      newsContext += `${i + 1}. ${item.title}\n`;
      if (item.description) newsContext += `   ${item.description}\n`;
    });
  }

  if (!newsContext) newsContext = 'No news feeds available today — summarize general market conditions.';

  const prompt = `You are Ooppyy, a sharp intelligence analyst with a witty edge. Today is ${date}.

Here are today's headlines:
${newsContext}

Write a morning intel brief. Cover these 4 sections:

1. WORLD & POLITICS (2-3 stories)
2. MARKETS & ECONOMICS (2-3 stories)
3. TECHNOLOGY & AI (2-3 stories)
4. FASHION & BEAUTY RETAIL - especially SEA, India, GCC markets (2-3 stories)

For each story:
Story: [what happened in 1 sentence]
So What: [1-2 sentences — specific implication for fashion/beauty distribution in SEA/India/GCC OR building an AI consulting agency in Singapore]

Use plain text and emojis only. No asterisks, no hashtags, no markdown.

End with:
TODAY'S OPPORTUNITIES & THREATS
2-3 specific actionable items worth your attention today.

Reader: Fashion & beauty distributor in SEA/India/GCC. Also building an AI consulting agency in Singapore.`;

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 2000
    })
  });

  const data = await response.json();
  if (!response.ok) throw new Error(`Groq error: ${JSON.stringify(data)}`);
  return data.choices[0].message.content;
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

async function sendToTelegram(brief) {
  const date = new Date().toLocaleDateString('en-SG', {
    timeZone: 'Asia/Singapore',
    month: 'short', day: 'numeric'
  });
  const fullMessage = `🌅 OOPPYY INTEL BRIEF — ${date}\n${'─'.repeat(30)}\n\n${brief}`;
  const chunks = splitMessage(fullMessage, 4000);
  for (const chunk of chunks) {
    const r = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text: chunk })
    });
    if (!r.ok) {
      const err = await r.json();
      throw new Error(`Telegram error: ${JSON.stringify(err)}`);
    }
  }
}

async function saveToNotion(brief) {
  const date = new Date().toLocaleDateString('en-SG', {
    timeZone: 'Asia/Singapore',
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
  const blocks = brief.split('\n').filter(p => p.trim()).map(line => ({
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
