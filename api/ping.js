/**
 * Serverless keep-alive endpoint (`/api/ping`).
 *
 * Protected by a 60-second in-memory cooldown shield so even if a DDoS bot floods
 * `/api/ping` with thousands of requests, at most 1 request per minute ever reaches Supabase.
 */
let lastPingMs = 0;
const MIN_INTERVAL_MS = 60_000;

export default async function handler(_req, res) {
  const now = Date.now();
  if (now - lastPingMs < MIN_INTERVAL_MS) {
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.status(200).json({ ok: true, cached: true, ts: new Date(lastPingMs).toISOString() });
    return;
  }

  const url =
    process.env.VITE_SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL;
  const key =
    process.env.VITE_SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY;

  if (!url || !key) {
    res.status(500).json({ ok: false, error: 'Missing Supabase environment variables' });
    return;
  }

  try {
    lastPingMs = now;
    const response = await fetch(`${url}/rest/v1/rpc/ping`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });

    if (!response.ok) {
      res.status(502).json({ ok: false, status: response.status });
      return;
    }

    res.setHeader('Cache-Control', 'public, max-age=60');
    res.status(200).json({ ok: true, ts: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
}
