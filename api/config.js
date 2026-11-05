/**
 * Runtime public configuration endpoint (`/api/config`).
 *
 * Allows Vercel environment variables (whether named VITE_SUPABASE_URL,
 * NEXT_PUBLIC_SUPABASE_URL, or SUPABASE_URL) to be picked up at runtime even
 * if they were added after the static Vite build ran.
 */
export default function handler(_req, res) {
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

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ url: url.trim(), anonKey: anonKey.trim() });
}
