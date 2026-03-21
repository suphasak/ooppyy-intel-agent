// scripts/log-build.mjs
import { execSync } from 'child_process';

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DB_ID = '32a94631-374e-8102-9d14-ef64c7f27ad4';

if (!NOTION_TOKEN) {
  console.error('ERROR: NOTION_TOKEN not set. Run: source .env.local or set env var.');
  process.exit(1);
}

const description = process.argv[2];
const tagsRaw = process.argv[3] || '';

if (!description) {
  console.error('Usage: node scripts/log-build.mjs "What you built" "Tag1,Tag2"');
  process.exit(1);
}

// Get commit SHA
let commitSha = 'unknown';
try {
  commitSha = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
} catch (e) {
  console.warn('Warning: could not read git SHA —', e.message);
}

const today = new Date().toISOString().split('T')[0];

const tags = tagsRaw
  ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean).map(name => ({ name }))
  : [];

const body = {
  parent: { database_id: DB_ID },
  properties: {
    Name: {
      title: [{ text: { content: description } }]
    },
    Date: {
      date: { start: today }
    },
    Status: {
      select: { name: 'Shipped' }
    },
    Tags: {
      multi_select: tags
    }
  }
};

// Add commit SHA as a note in the page body if available
const children = commitSha !== 'unknown' ? [
  {
    object: 'block',
    type: 'paragraph',
    paragraph: {
      rich_text: [{ type: 'text', text: { content: 'Commit: ' + commitSha } }]
    }
  }
] : [];

if (children.length) body.children = children;

const res = await fetch('https://api.notion.com/v1/pages', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + NOTION_TOKEN,
    'Content-Type': 'application/json',
    'Notion-Version': '2022-06-28'
  },
  body: JSON.stringify(body)
});

if (!res.ok) {
  const err = await res.json().catch(() => ({ message: 'unknown error' }));
  console.error('Notion API error:', err.message || JSON.stringify(err));
  process.exit(1);
}

const data = await res.json();
console.log('Logged to Notion:', data.url);
console.log('  Build:', description);
console.log('  Commit:', commitSha);
console.log('  Tags:', tags.map(t => t.name).join(', ') || 'none');
