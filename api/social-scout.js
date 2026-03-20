const AGENT_VERSION = '1.1';
const AGENT_NAME = 'Social Scout';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

// ── Brand definitions by geo ──────────────────────────────────────────────────
const GEO_GROUPS = [
  {
    geo: 'GCC',
    brands: [
      { name: 'US Polo Assn', category: 'footwear' },
      { name: 'FC (French Connection)', category: 'apparel/bags' },
      { name: 'Keds', category: 'footwear' },
      { name: 'Penti', category: 'innerwear' },
      { name: 'Puma', category: 'footwear' },
      { name: 'Vero Moda', category: 'apparel' },
      { name: 'Von Dutch', category: 'apparel' },
      { name: 'Campus Shoes', category: 'footwear' },
      { name: 'White Stuff', category: 'apparel' },
    ],
  },
  {
    geo: 'India',
    brands: [
      { name: 'Jack & Jones', category: 'apparel' },
      { name: 'Cardio Bunny', category: 'sportswear' },
    ],
  },
  {
    geo: 'SEA',
    brands: [
      { name: 'Campus Shoes', category: 'footwear' },
      { name: 'Penti', category: 'innerwear' },
      { name: 'Lyle & Scott', category: 'apparel' },
    ],
  },
];

const SIGNAL_TYPES = [
  'new product launch or collection drop',
  'distribution or partnership announcement',
  'new market entry (brand entering a new country)',
  'store opening, shop-in-shop, or new retail presence',
  'campaign or collaboration',
  'funding or acquisition news',
  'competitor brand making a significant move in the same category/geo',
  'distributor gaining rights to sell online (marketplace/D2C) or offline (retail/SIS)',
];

const SIGNAL_EMOJIS = {
  launch: '🚀',
  partnership: '🤝',
  'market entry': '🌏',
  'store/retail': '🏪',
  campaign: '🎯',
  funding: '💰',
  competitor: '⚠️',
  distribution: '📦',
};

export default async function handler(req, res) {
  const runId = `scout-${Date.now()}`;
  console.log(`[${AGENT_NAME}] v${AGENT_VERSION} starting — runId: ${runId}`);

  try {
    // Single Groq call for all brands — avoids rate limits, fits in 60s
    let allFindings = [];
    let results = [];
    try {
      allFindings = await searchAllBrands();
      results = [{ status: 'fulfilled', count: allFindings.length }];
    } catch (e) {
      const errMsg = e?.message || String(e) || 'unknown error';
      results = [{ status: 'rejected', count: 0, error: errMsg.substring(0, 300) }];
      console.error(`[${AGENT_NAME}] Search error:`, errMsg);
    }

    console.log(`[${AGENT_NAME}] Raw findings: ${allFindings.length}`);

    // Filter to score >= 7
    const qualified = allFindings.filter(f => (f.score || 0) >= 7);
    console.log(`[${AGENT_NAME}] Qualified findings (score 7+): ${qualified.length}`);

    // Deduplicate via Supabase
    const newFindings = await deduplicateFindings(qualified);
    console.log(`[${AGENT_NAME}] New (not seen before): ${newFindings.length}`);

    // Save ALL findings to Notion (full audit trail — including sub-7)
    const dateLabel = getSGTDateLabel();
    await saveToNotion(allFindings, dateLabel);

    // Only alert if there are new qualified findings
    if (newFindings.length > 0) {
      await sendToTelegram(newFindings);
      await markFindingsSent(newFindings);
    }

    // Persist all qualified findings (upsert, idempotent)
    await saveQualifiedToSupabase(qualified);

    res.status(200).json({
      success: true,
      runId,
      rawFindings: allFindings.length,
      qualifiedFindings: qualified.length,
      newFindings: newFindings.length,
      telegramSent: newFindings.length > 0,
      debug: results,
    });
  } catch (error) {
    console.error(`[${AGENT_NAME}] Fatal error:`, error);
    res.status(500).json({ error: error.message });
  }
}

// ── Groq search (compound-beta — built-in web search, single call) ────────────

async function searchAllBrands() {
  const signalList = SIGNAL_TYPES.map((s, i) => `${i + 1}. ${s}`).join('\n');

  const brandsByGeo = GEO_GROUPS.map(g =>
    `${g.geo}: ${g.brands.map(b => `${b.name} (${b.category})`).join(', ')}`
  ).join('\n');

  const prompt = `You are a fashion industry intelligence analyst. Today is ${getSGTDateLabel()}.

Search the web for the LATEST news (past 7 days) for these fashion/footwear brands across GCC, India, and SEA:

${brandsByGeo}

For each brand, look for:
${signalList}

Also identify key COMPETITOR brands making notable moves in the same categories.

Return a JSON array. Each item must have:
- brand: brand name
- geo: GCC | India | SEA
- headline: one sharp sentence (max 15 words)
- summary: one sentence implication (max 25 words)
- signal_type: launch | partnership | market entry | store/retail | campaign | funding | competitor | distribution
- score: 1-10 (recency + business impact + novelty)
- source_url: URL or ""

Rules: only REAL verifiable news. No fabrication. Output ONLY a valid JSON array, nothing else.`;

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'compound-beta',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      max_tokens: 2048,
    }),
    signal: AbortSignal.timeout(60000),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Groq API error (${response.status}): ${err.substring(0, 300)}`);
  }

  const data = await response.json();
  const rawText = data?.choices?.[0]?.message?.content || '[]';

  // Extract JSON array from response (handles prose before/after, code fences)
  const start = rawText.indexOf('[');
  const end = rawText.lastIndexOf(']');
  const cleaned = start !== -1 && end > start ? rawText.slice(start, end + 1) : '[]';

  let findings;
  try {
    findings = JSON.parse(cleaned);
    if (!Array.isArray(findings)) findings = [];
  } catch (e) {
    console.error(`[${AGENT_NAME}] JSON parse failed:`, cleaned.substring(0, 300));
    findings = [];
  }

  // Stamp with found_at and content_hash
  return findings.map(f => ({
    ...f,
    geo: f.geo || geo,
    score: Math.min(10, Math.max(1, parseInt(f.score) || 5)),
    found_at: new Date().toISOString(),
    content_hash: simpleHash(`${f.brand}|${f.headline}|${f.geo}`),
  }));
}

// ── Deduplication ─────────────────────────────────────────────────────────────

async function deduplicateFindings(findings) {
  if (!SUPABASE_URL || !SUPABASE_KEY || !findings.length) return findings;

  try {
    const hashes = findings.map(f => f.content_hash);
    // Check which hashes already exist in scout_findings
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/scout_findings?select=content_hash&content_hash=in.(${hashes.map(h => `"${h}"`).join(',')})`,
      {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
        },
      }
    );

    if (!r.ok) {
      console.error('[${AGENT_NAME}] Supabase dedup check failed:', await r.text());
      return findings; // Fail open — send all rather than miss something
    }

    const existing = await r.json();
    const existingHashes = new Set((existing || []).map(row => row.content_hash));
    return findings.filter(f => !existingHashes.has(f.content_hash));
  } catch (e) {
    console.error(`[${AGENT_NAME}] Dedup error:`, e.message);
    return findings; // Fail open
  }
}

async function saveQualifiedToSupabase(findings) {
  if (!SUPABASE_URL || !SUPABASE_KEY || !findings.length) return;

  try {
    const rows = findings.map(f => ({
      brand: f.brand || '',
      geo: f.geo || '',
      headline: f.headline || '',
      summary: f.summary || '',
      signal_type: f.signal_type || '',
      score: f.score || 0,
      source_url: f.source_url || null,
      content_hash: f.content_hash,
      found_at: f.found_at || new Date().toISOString(),
      sent_at: null,
    }));

    const r = await fetch(`${SUPABASE_URL}/rest/v1/scout_findings`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=ignore-duplicates,return=minimal',
      },
      body: JSON.stringify(rows),
    });

    if (!r.ok) {
      console.error(`[${AGENT_NAME}] Supabase insert error:`, await r.text());
    }
  } catch (e) {
    console.error(`[${AGENT_NAME}] Supabase save error:`, e.message);
  }
}

async function markFindingsSent(findings) {
  if (!SUPABASE_URL || !SUPABASE_KEY || !findings.length) return;

  try {
    const hashes = findings.map(f => f.content_hash);
    await fetch(
      `${SUPABASE_URL}/rest/v1/scout_findings?content_hash=in.(${hashes.map(h => `"${h}"`).join(',')})`,
      {
        method: 'PATCH',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({ sent_at: new Date().toISOString() }),
      }
    );
  } catch (e) {
    console.error(`[${AGENT_NAME}] markSent error:`, e.message);
  }
}

// ── Telegram ──────────────────────────────────────────────────────────────────

async function sendToTelegram(findings) {
  const sgTime = new Date().toLocaleTimeString('en-SG', {
    timeZone: 'Asia/Singapore',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  // Sort by score desc, cap display at 5
  const sorted = [...findings].sort((a, b) => (b.score || 0) - (a.score || 0));
  const toShow = sorted.slice(0, 5);
  const overflow = sorted.length - toShow.length;

  let msg = `🕵️ <b>Social Scout — ${sgTime} SGT</b>\n\n`;

  for (const f of toShow) {
    const signalEmoji = getSignalEmoji(f.signal_type);
    const scoreBar = buildScoreBar(f.score);
    msg += `${signalEmoji} <b>${escHTML(f.brand)}</b> · ${escHTML(f.geo)} · ${escHTML(f.signal_type)}\n`;
    msg += `${escHTML(f.headline)}\n`;
    msg += `${escHTML(f.summary)}`;
    if (f.source_url) msg += ` <a href="${f.source_url}">↗</a>`;
    msg += `\n${scoreBar} ${f.score}/10\n\n`;
  }

  if (overflow > 0) {
    msg += `+${overflow} more findings saved to Notion\n`;
  }

  const r = await fetch(
    `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: process.env.TELEGRAM_CHAT_ID,
        text: msg,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    }
  );

  if (!r.ok) {
    const err = await r.json();
    throw new Error(`Telegram error: ${JSON.stringify(err)}`);
  }
}

// ── Notion ────────────────────────────────────────────────────────────────────

async function saveToNotion(allFindings, dateLabel) {
  if (!allFindings.length) {
    // Still create a page but note nothing found
    allFindings = [];
  }

  const sgTime = new Date().toLocaleTimeString('en-SG', {
    timeZone: 'Asia/Singapore',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const qualified = allFindings.filter(f => (f.score || 0) >= 7);
  const subThreshold = allFindings.filter(f => (f.score || 0) < 7);

  const metaRow = (label, value) => ({
    object: 'block',
    type: 'paragraph',
    paragraph: {
      rich_text: [
        { type: 'text', text: { content: `${label}  ` }, annotations: { bold: true } },
        { type: 'text', text: { content: value } },
      ],
    },
  });

  const findingBlock = (f) => {
    const signalEmoji = getSignalEmoji(f.signal_type);
    const blocks = [
      {
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [
            {
              type: 'text',
              text: { content: `${signalEmoji} [${f.score}/10] ${f.brand} · ${f.geo} · ${f.signal_type}` },
              annotations: { bold: true },
            },
          ],
        },
      },
      {
        object: 'block',
        type: 'quote',
        quote: {
          rich_text: [{ type: 'text', text: { content: f.headline } }],
        },
      },
      {
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [{ type: 'text', text: { content: f.summary || '' } }],
        },
      },
    ];

    if (f.source_url) {
      blocks.push({
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [
            {
              type: 'text',
              text: { content: `Source: ${f.source_url}` },
              annotations: { color: 'blue' },
            },
          ],
        },
      });
    }

    return blocks;
  };

  const blocks = [
    {
      object: 'block',
      type: 'callout',
      callout: {
        icon: { type: 'emoji', emoji: '📡' },
        color: 'purple_background',
        rich_text: [
          {
            type: 'text',
            text: {
              content: `${AGENT_NAME} v${AGENT_VERSION}  ·  ${allFindings.length} total findings  ·  ${qualified.length} scored 7+  ·  Run at ${sgTime} SGT`,
            },
          },
        ],
      },
    },
    metaRow('📅 Date:', dateLabel),
    metaRow('🔢 Total findings:', `${allFindings.length}`),
    metaRow('✅ Qualified (7+):', `${qualified.length}`),
    metaRow('📉 Below threshold:', `${subThreshold.length}`),
    { object: 'block', type: 'divider', divider: {} },

    // Qualified findings
    ...(qualified.length > 0
      ? [
          {
            object: 'block',
            type: 'heading_2',
            heading_2: { rich_text: [{ type: 'text', text: { content: '✅ Qualified Findings (Score 7+)' } }] },
          },
          ...qualified
            .sort((a, b) => (b.score || 0) - (a.score || 0))
            .flatMap(f => findingBlock(f)),
          { object: 'block', type: 'divider', divider: {} },
        ]
      : [
          {
            object: 'block',
            type: 'paragraph',
            paragraph: {
              rich_text: [{ type: 'text', text: { content: 'No qualified findings (score 7+) this run.' }, annotations: { italic: true } }],
            },
          },
          { object: 'block', type: 'divider', divider: {} },
        ]),

    // Sub-threshold findings (audit trail)
    ...(subThreshold.length > 0
      ? [
          {
            object: 'block',
            type: 'heading_2',
            heading_2: { rich_text: [{ type: 'text', text: { content: '📉 Below Threshold (Score < 7)' } }] },
          },
          ...subThreshold
            .sort((a, b) => (b.score || 0) - (a.score || 0))
            .flatMap(f => findingBlock(f)),
        ]
      : []),
  ];

  const r = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.NOTION_TOKEN}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28',
    },
    body: JSON.stringify({
      parent: { page_id: process.env.NOTION_PAGE_ID },
      properties: {
        title: {
          title: [{ text: { content: `📡 Scout Log — ${dateLabel} ${sgTime} SGT` } }],
        },
      },
      children: blocks.slice(0, 100),
    }),
  });

  if (!r.ok) {
    const err = await r.json();
    throw new Error(`Notion error: ${JSON.stringify(err)}`);
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function getSGTDateLabel() {
  return new Date().toLocaleDateString('en-SG', {
    timeZone: 'Asia/Singapore',
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function getSignalEmoji(signalType) {
  const t = (signalType || '').toLowerCase();
  if (t.includes('launch') || t.includes('product') || t.includes('collection')) return SIGNAL_EMOJIS.launch;
  if (t.includes('partnership')) return SIGNAL_EMOJIS.partnership;
  if (t.includes('market entry') || t.includes('market')) return SIGNAL_EMOJIS['market entry'];
  if (t.includes('store') || t.includes('retail')) return SIGNAL_EMOJIS['store/retail'];
  if (t.includes('campaign') || t.includes('collab')) return SIGNAL_EMOJIS.campaign;
  if (t.includes('funding') || t.includes('acquisition')) return SIGNAL_EMOJIS.funding;
  if (t.includes('competitor')) return SIGNAL_EMOJIS.competitor;
  if (t.includes('distribution')) return SIGNAL_EMOJIS.distribution;
  return '📌';
}

function buildScoreBar(score) {
  const filled = Math.round((score || 0) / 10 * 6);
  const empty = 6 - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

function escHTML(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Simple deterministic hash — no crypto module needed in edge runtime
function simpleHash(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
    hash = hash >>> 0; // keep as unsigned 32-bit
  }
  return hash.toString(16).padStart(8, '0');
}
