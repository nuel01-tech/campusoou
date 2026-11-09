import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const STORAGE_URL_KEY = 'campuspulse_supabase_url';
const STORAGE_ANON_KEY = 'campuspulse_supabase_anon_key';

const env = import.meta.env as Record<string, string | undefined>;

export function isSecretKey(k?: string | null): boolean {
  return /^sb_secret_/i.test((k ?? '').trim());
}

function isValidConfig(u?: string | null, k?: string | null): boolean {
  const cleanUrl = (u ?? '').trim();
  const cleanKey = (k ?? '').trim();
  return Boolean(
    cleanUrl &&
      cleanKey &&
      /^https?:\/\//i.test(cleanUrl) &&
      !cleanUrl.includes('your-project') &&
      !cleanKey.includes('your-anon-key') &&
      !isSecretKey(cleanKey),
  );
}

export function clearSavedConfig(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_URL_KEY);
    window.localStorage.removeItem(STORAGE_ANON_KEY);
  } catch {
    // ignore
  }
}

function readInitialConfig(): { url: string; anonKey: string; configured: boolean } {
  const envUrl =
    env.VITE_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
  const envKey =
    env.VITE_SUPABASE_ANON_KEY ||
    env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||
    env.SUPABASE_ANON_KEY;

  if (isValidConfig(envUrl, envKey)) {
    // Clean up any legacy keys left in localStorage so keys stay in memory only
    clearSavedConfig();
    return { url: envUrl!.trim(), anonKey: envKey!.trim(), configured: true };
  }

  if (typeof window !== 'undefined') {
    try {
      const savedUrl = window.localStorage.getItem(STORAGE_URL_KEY);
      const savedKey = window.localStorage.getItem(STORAGE_ANON_KEY);
      if (isSecretKey(savedKey)) {
        clearSavedConfig();
      } else if (isValidConfig(savedUrl, savedKey)) {
        return { url: savedUrl!.trim(), anonKey: savedKey!.trim(), configured: true };
      }
    } catch {
      // ignore storage errors
    }
  }

  return {
    url: 'http://localhost:54321',
    anonKey: 'missing-anon-key',
    configured: false,
  };
}

const initial = readInitialConfig();

export let isConfigured = initial.configured;
let activeUrl = initial.url;
let activeKey = initial.anonKey;

export let supabase: SupabaseClient = createClient(activeUrl, activeKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

/** Saves credentials in memory (and optionally localStorage for manual setup) and re-initializes the Supabase client. */
export function saveRuntimeConfig(url: string, anonKey: string, persistToStorage = true): boolean {
  const cleanUrl = url.trim();
  const cleanKey = anonKey.trim();
  if (!isValidConfig(cleanUrl, cleanKey)) return false;

  if (persistToStorage) {
    try {
      window.localStorage.setItem(STORAGE_URL_KEY, cleanUrl);
      window.localStorage.setItem(STORAGE_ANON_KEY, cleanKey);
    } catch {
      // ignore storage errors
    }
  } else {
    clearSavedConfig();
  }

  activeUrl = cleanUrl;
  activeKey = cleanKey;
  isConfigured = true;
  supabase = createClient(activeUrl, activeKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  return true;
}

/** Attempts to fetch runtime config from `/api/config` (e.g. on Vercel) into memory only. */
export async function tryLoadServerConfig(): Promise<boolean> {
  if (isConfigured) return true;
  try {
    const res = await fetch('/api/config', { cache: 'no-store' });
    if (!res.ok) return false;
    const data = (await res.json()) as { url?: string; anonKey?: string };
    if (isValidConfig(data.url, data.anonKey)) {
      return saveRuntimeConfig(data.url!, data.anonKey!, false);
    }
  } catch {
    // /api/config not available in local vite dev server
  }
  return false;
}

/**
 * Non-persisting client used when the Super Admin creates a Class Rep account,
 * so `auth.signUp` does not replace the Super Admin's active session.
 */
export function createIsolatedClient(): SupabaseClient {
  return createClient(activeUrl, activeKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: 'sb-isolated-admin-provision',
    },
  });
}
