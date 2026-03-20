export default async function handler(req, res) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;

  if (!url || !key) {
    return res.status(200).json({
      ok: false,
      error: 'Missing env vars',
      SUPABASE_URL: url ? 'set' : 'MISSING',
      SUPABASE_SERVICE_KEY: key ? 'set' : 'MISSING'
    });
  }

  // Try inserting a test row
  const r = await fetch(`${url}/rest/v1/briefs`, {
    method: 'POST',
    headers: {
      'apikey': key,
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    },
    body: JSON.stringify({
      brief_num: 0,
      date: 'TEST',
      agent_version: 'test',
      story_count: 0,
      sections: [],
      opportunities: []
    })
  });

  const text = await r.text();
  res.status(200).json({ status: r.status, ok: r.ok, response: text.substring(0, 300) });
}
