export default async function handler(req, res) {
  try {
    const brief = await generateBrief();
    await sendToTelegram(brief);
    await saveToNotion(brief);
    res.status(200).json({ success: true, message: 'Intel brief sent!' });
  } catch (error) {
    console.error('Ooppyy brief error:', error);
    res.status(500).json({ error: error.message });
  }
}

async function generateBrief() {
  const date = new Date().toLocaleDateString('en-SG', {
    timeZone: 'Asia/Singapore',
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  const prompt = `You are Ooppyy, a sharp intelligence analyst with a witty edge. Research and summarize today's most important news for ${date}.

Cover these 4 categories:

1. WORLD NEWS & POLITICS (2-3 stories)
2. MARKETS & ECONOMICS (2-3 stories)
3. TECHNOLOGY & AI (2-3 stories)
4. FASHION & BEAUTY RETAIL - especially SEA (Singapore, Thailand, Vietnam, Indonesia), India, and GCC (UAE, Saudi Arabia) markets (2-3 stories)

For EACH story write exactly:
Story: [headline in 1 sentence]
So What: [1-2 sentences on what this means for either: fashion/beauty distribution in SEA/India/GCC, OR building an AI consulting agency in Singapore]

Use plain text and emojis only. No asterisks, no hashtags, no markdown symbols.

End with a section called:
TODAY'S OPPORTUNITIES & THREATS
List 2-3 specific actionable items worth attention today, tailored to the reader's work.

Reader profile: Fashion and beauty distributor operating in SEA, India, and GCC. Also building an AI consulting agency in Singapore with a friend.`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tools: [{ google_search: {} }],
        contents: [{ parts: [{ text: prompt }] }]
      })
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`Gemini API error: ${JSON.stringify(data)}`);
  }

  return data.candidates[0].content.parts[0].text;
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

  const header = `🌅 OOPPYY INTEL BRIEF — ${date}\n${'─'.repeat(30)}\n\n`;
  const fullMessage = header + brief;
  const chunks = splitMessage(fullMessage, 4000);

  for (const chunk of chunks) {
    const response = await fetch(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: process.env.TELEGRAM_CHAT_ID,
          text: chunk
        })
      }
    );
    if (!response.ok) {
      const err = await response.json();
      throw new Error(`Telegram error: ${JSON.stringify(err)}`);
    }
  }
}

async function saveToNotion(brief) {
  const date = new Date().toLocaleDateString('en-SG', {
    timeZone: 'Asia/Singapore',
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  const lines = brief.split('\n').filter(p => p.trim());
  const blocks = lines.map(line => ({
    object: 'block',
    type: 'paragraph',
    paragraph: {
      rich_text: [{ type: 'text', text: { content: line.substring(0, 2000) } }]
    }
  }));

  const response = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.NOTION_TOKEN}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28'
    },
    body: JSON.stringify({
      parent: { page_id: process.env.NOTION_PAGE_ID },
      properties: {
        title: {
          title: [{ text: { content: `📰 Intel Brief — ${date}` } }]
        }
      },
      children: blocks.slice(0, 100)
    })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Notion error: ${JSON.stringify(error)}`);
  }
}
