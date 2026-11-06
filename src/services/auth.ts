import type { Session as AuthSession, User } from '@supabase/supabase-js';
import { supabase } from './db';
import { AppError, appError, toAppError } from '@/lib/errors';
import type { Profile } from '@/types';

export type Role = 'super_admin' | 'rep' | 'student';

export async function getAuthSession(): Promise<AuthSession | null> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw toAppError(error);
  return data.session;
}

export function onAuthChange(cb: (session: AuthSession | null) => void): () => void {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => cb(session));
  return () => data.subscription.unsubscribe();
}

export async function getMyProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
  if (error) throw toAppError(error);
  return (data as Profile | null) ?? null;
}

/** Returns true if a Super Admin account has already been set up. */
export async function hasSuperAdmin(): Promise<boolean> {
  const { data, error } = await supabase.rpc('has_super_admin');
  if (error) throw toAppError(error);
  return Boolean(data);
}

export async function signInStaff(
  email: string,
  password: string,
  expectedRole: 'super_admin' | 'rep' = 'rep',
): Promise<Profile> {
  const cleanEmail = email.trim().toLowerCase();
  const { data, error } = await supabase.auth.signInWithPassword({ email: cleanEmail, password });
  if (error) {
    if (/invalid login credentials/i.test(error.message)) {
      const adminExists = await hasSuperAdmin().catch(() => true);
      if (!adminExists) {
        throw new AppError(
          'AUTH',
          'No Super Admin account has been created yet. Use "First-Time Setup (Create Super Admin)" to create your account first.',
        );
      }
      throw new AppError(
        'AUTH',
        expectedRole === 'super_admin'
          ? 'Super Admin sign-in failed. Check the Super Admin email address and password. If this database already has a Super Admin, first-time setup is locked; recover that existing account rather than creating another one.'
          : 'Incorrect email or password. Class Reps must use the email and password created for them by the Super Admin.',
      );
    }
    if (/email not confirmed/i.test(error.message)) {
      throw new AppError(
        'AUTH',
        'Your email is not confirmed yet. Re-run supabase/migrations/0001_init.sql in your Supabase SQL Editor (it automatically confirms existing accounts).',
      );
    }
    throw toAppError(error);
  }

  let profile = data.user ? await getMyProfile(data.user.id) : null;
  if (!profile && data.user) {
    // If this user was created before the trigger ran and no super_admin exists yet, promote them.
    const { data: promoted } = await supabase.rpc('ensure_first_super_admin', { p_full_name: null });
    profile = (promoted as Profile | null) ?? null;
  }

  if (!profile) {
    await supabase.auth.signOut();
    throw new AppError(
      'AUTH',
      expectedRole === 'super_admin'
        ? 'This login does not have a Super Admin profile. Use the email belonging to the existing Super Admin account.'
        : 'This account does not have a Class Rep or Super Admin profile. Ask the Super Admin to create your Class Rep account.',
    );
  }
  if (expectedRole === 'super_admin' && profile.role !== 'super_admin') {
    await supabase.auth.signOut();
    throw new AppError(
      'AUTH',
      'This is a Class Rep account, not the Super Admin account. Open the Class Rep sign-in page instead.',
    );
  }
  if (!profile.active) {
    await supabase.auth.signOut();
    throw appError('ACCOUNT_SUSPENDED');
  }
  return profile;
}

/**
 * Bootstraps the very first Super Admin account.
 *
 * Uses the `bootstrap_super_admin` database RPC first so account creation
 * happens directly inside Postgres (zero SMTP / 503 timeouts), then signs the
 * Super Admin in with `signInWithPassword`.
 */
export async function bootstrapSuperAdmin(fullName: string, email: string, password: string): Promise<Profile> {
  const cleanEmail = email.trim().toLowerCase();
  const cleanName = fullName.trim();

  // If the user is currently signed in anonymously as a student on this browser, sign out first.
  const current = await getAuthSession().catch(() => null);
  if (current?.user?.is_anonymous) {
    await supabase.auth.signOut().catch(() => {});
  }

  // Primary path: direct server-side creation via `bootstrap_super_admin` RPC (no SMTP / 503).
  const { error: rpcErr } = await supabase.rpc('bootstrap_super_admin', {
    p_full_name: cleanName,
    p_email: cleanEmail,
    p_password: password,
  });

  if (!rpcErr) {
    return signInStaff(cleanEmail, password, 'super_admin');
  }

  const mappedRpcErr = toAppError(rpcErr);
  // If the RPC exists and rejected the call (e.g. SIGNUP_NOT_ALLOWED), surface that error unless
  // the user is trying to sign in with the existing Super Admin credentials.
  if (mappedRpcErr.code === 'SIGNUP_NOT_ALLOWED') {
    try {
      return await signInStaff(cleanEmail, password, 'super_admin');
    } catch {
      throw mappedRpcErr;
    }
  }
  if (mappedRpcErr.code !== 'DB_NOT_MIGRATED') {
    throw mappedRpcErr;
  }

  // Fallback path if the user has not re-run the latest 0001_init.sql with `bootstrap_super_admin` yet:
  const { data, error } = await supabase.auth.signUp({
    email: cleanEmail,
    password,
    options: { data: { full_name: cleanName } },
  });

  if (error) {
    if (/SIGNUP_NOT_ALLOWED|Database error saving new user/i.test(error.message)) {
      throw appError('SIGNUP_NOT_ALLOWED');
    }
    if (/already registered/i.test(error.message)) {
      return signInStaff(cleanEmail, password, 'super_admin');
    }
    throw toAppError(error);
  }

  if (!data.session) {
    return signInStaff(cleanEmail, password, 'super_admin');
  }

  let profile = data.user ? await getMyProfile(data.user.id) : null;
  if (!profile) {
    const { data: promoted, error: promErr } = await supabase.rpc('ensure_first_super_admin', {
      p_full_name: cleanName,
    });
    if (promErr) throw toAppError(promErr);
    profile = (promoted as Profile | null) ?? null;
  }
  if (!profile) throw appError('DB_NOT_MIGRATED');
  return profile;
}

/** Students get an anonymous account, created the first time they open a join link. */
export async function ensureStudentSession(): Promise<User> {
  const session = await getAuthSession();
  if (session?.user) return session.user;
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error || !data.user) {
    if (error && /anonymous sign-ins are disabled/i.test(error.message)) {
      throw new AppError(
        'CONFIG',
        'Anonymous Sign-Ins are not enabled in Supabase yet. In Supabase Dashboard → Authentication → Providers → Anonymous Sign-Ins, toggle it ON.',
      );
    }
    throw toAppError(error);
  }
  return data.user;
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) throw toAppError(error);
}
