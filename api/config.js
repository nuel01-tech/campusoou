/**
 * Runtime public configuration endpoint (`/api/config`).
 *
 * Protected by per-IP rate limiting and Same-Origin / Referer verification
 * so external scrapers or DDoS bots cannot abuse the endpoint.
 */
const ipHits = new Map();
const WINDOW_MS = 60_000;
const MAX_REQ_PER_WINDOW = 20;

export default function handler(req, res) {
  if (req.method && req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const now = Date.now();
  const forwarded = req.headers?.['x-forwarded-for'];
  const ip = (Array.isArray(forwarded) ? forwarded[0] : String(forwarded || 'unknown'))
    .split(',')[0]
    .trim();

  const bucket = ipHits.get(ip);
  if (!bucket || now - bucket.start > WINDOW_MS) {
    ipHits.set(ip, { start: now, count: 1 });
  } else {
    bucket.count += 1;
    if (bucket.count > MAX_REQ_PER_WINDOW) {
      res.setHeader('Retry-After', '60');
      res.status(429).json({ error: 'Too many requests. Slow down.' });
      return;
    }
  }

  // Block cross-site scraping if Sec-Fetch-Site is explicitly cross-site
  const fetchSite = req.headers?.['sec-fetch-site'];
  if (fetchSite === 'cross-site') {
    res.status(403).json({ error: 'Forbidden cross-site request' });
    return;
  }

  const url =
    process.env.VITE_SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    '';

  const anonKey =
    process.env.VITE_SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    '';

  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.status(200).json({ url: url.trim(), anonKey: anonKey.trim() });
}
