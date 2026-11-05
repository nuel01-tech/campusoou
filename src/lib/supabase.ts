import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();

export const isConfigured = Boolean(
  url &&
    anonKey &&
    /^https?:\/\//i.test(url) &&
    !url.includes('your-project') &&
    !anonKey.includes('your-anon-key'),
);

const resolvedUrl = isConfigured ? url! : 'http://localhost:54321';
const resolvedKey = isConfigured ? anonKey! : 'missing-anon-key';

/**
 * Single shared client. When env vars are missing we still create a client
 * against a placeholder so imports don't crash; the App shell shows a setup
 * screen instead of making requests (see `isConfigured`).
 */
export const supabase: SupabaseClient = createClient(resolvedUrl, resolvedKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

/**
 * Non-persisting client used when the Super Admin creates a Class Rep account,
 * so `auth.signUp` does not replace the Super Admin's active session.
 */
export function createIsolatedClient(): SupabaseClient {
  return createClient(resolvedUrl, resolvedKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: 'sb-isolated-admin-provision',
    },
  });
}
