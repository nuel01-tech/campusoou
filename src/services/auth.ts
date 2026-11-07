import type { Session as AuthSession, User } from '@supabase/supabase-js';
import { supabase } from './db';
import { AppError, appError, toAppError } from '@/lib/errors';
import type { Profile } from '@/types';

export type Role = 'super_admin' | 'rep' | 'student';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

/**
 * Returns true if the student has attached a permanent email login to their account.
 */
export function hasPermanentStudentLogin(user: User | null | undefined): boolean {
  const email = user?.email?.trim();
  return Boolean(email && EMAIL_RE.test(email));
}

/**
 * Upgrade the currently claimed anonymous student session into a permanent email/password account.
 * Keeps the exact same Supabase auth user ID so the roster claim, passkey, and attendance history stay linked.
 */
export async function createStudentLogin(email: string, password: string): Promise<void> {
  const cleanEmail = email.trim().toLowerCase();
  if (!cleanEmail || !EMAIL_RE.test(cleanEmail)) {
    throw new AppError('VALIDATION', 'Enter a valid email address.');
  }
  if (password.length < 8) {
    throw new AppError('VALIDATION', 'Your password must contain at least 8 characters.');
  }

  // Primary path: direct server-side upgrade via `save_student_credentials` RPC
  // (sets email, password hash, email_confirmed_at, is_anonymous = false, and auth.identities atomically).
  const { data: rpcEmail, error: rpcErr } = await supabase.rpc('save_student_credentials', {
    p_email: cleanEmail,
    p_password: password,
  });

  if (!rpcErr) {
    const finalEmail =
      typeof rpcEmail === 'string' && rpcEmail.trim() ? rpcEmail.trim().toLowerCase() : cleanEmail;
    // Re-authenticate with the newly saved credentials so the client receives a fresh non-anonymous JWT immediately.
    const { error: signInErr } = await supabase.auth.signInWithPassword({
      email: finalEmail,
      password,
    });
    if (signInErr) {
      await supabase.auth.refreshSession().catch(() => {});
    }
    return;
  }

  const mappedRpcErr = toAppError(rpcErr);
  if (mappedRpcErr.code !== 'DB_NOT_MIGRATED') {
    throw mappedRpcErr;
  }

  // Fallback path when `save_student_credentials` migration has not been run yet:
  const { data: emailData, error: emailError } = await supabase.auth.updateUser({ email: cleanEmail });
  if (emailError) throw toAppError(emailError);
  if (!emailData.user) throw new AppError('AUTH', 'Could not save your student email.');

  const savedEmail = emailData.user.email?.trim().toLowerCase();
  if (savedEmail !== cleanEmail) {
    throw new AppError(
      'AUTH',
      'Supabase requires email confirmation before linking a password, or the database migration is out of date. Run supabase/migrations/0002_student_profile_management.sql (or 0001_init.sql) in your Supabase SQL Editor so student logins activate immediately.',
    );
  }

  const { data: passwordData, error: passwordError } = await supabase.auth.updateUser({ password });
  if (passwordError) throw toAppError(passwordError);
  if (!passwordData.user) {
    throw new AppError('AUTH', 'Could not save your student password. Please try again.');
  }

  await supabase.auth.refreshSession().catch(() => {});
}

/** Update credentials for an already claimed permanent student account. */
export async function updateStudentCredentials(email: string, password: string): Promise<void> {
  const cleanEmail = email.trim().toLowerCase();
  if (cleanEmail && !EMAIL_RE.test(cleanEmail)) {
    throw new AppError('VALIDATION', 'Enter a valid email address.');
  }
  if (password && password.length < 8) {
    throw new AppError('VALIDATION', 'Your password must contain at least 8 characters.');
  }
  if (!cleanEmail && !password) {
    throw new AppError('VALIDATION', 'Enter a new email address or password.');
  }

  // Primary path: direct server-side update via `save_student_credentials` RPC
  const { data: rpcEmail, error: rpcErr } = await supabase.rpc('save_student_credentials', {
    p_email: cleanEmail || null,
    p_password: password || null,
  });

  if (!rpcErr) {
    const finalEmail =
      typeof rpcEmail === 'string' && rpcEmail.trim() ? rpcEmail.trim().toLowerCase() : cleanEmail;
    if (password && finalEmail) {
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email: finalEmail,
        password,
      });
      if (signInErr) {
        await supabase.auth.refreshSession().catch(() => {});
      }
    } else {
      await supabase.auth.refreshSession().catch(() => {});
    }
    return;
  }

  const mappedRpcErr = toAppError(rpcErr);
  if (mappedRpcErr.code !== 'DB_NOT_MIGRATED') {
    throw mappedRpcErr;
  }

  // Fallback path when `save_student_credentials` migration has not been run yet:
  let pendingEmailMessage: string | null = null;

  if (cleanEmail) {
    const { data, error } = await supabase.auth.updateUser({ email: cleanEmail });
    if (error) throw toAppError(error);
    if (!data.user) throw new AppError('AUTH', 'Could not update your student email.');

    if (data.user.email?.trim().toLowerCase() !== cleanEmail) {
      const currentEmail = data.user.email?.trim().toLowerCase();
      pendingEmailMessage = currentEmail
        ? `The email change is still pending confirmation. Your current login email is ${currentEmail}. `
        : 'The email change is still pending confirmation. ';
    }
  }

  if (password) {
    const { data, error } = await supabase.auth.updateUser({ password });
    if (error) throw toAppError(error);
    if (!data.user) throw new AppError('AUTH', 'Could not update your student password.');
  }

  await supabase.auth.refreshSession().catch(() => {});

  if (pendingEmailMessage) {
    throw new AppError(
      'AUTH',
      `${pendingEmailMessage}${password ? 'Your password has been updated. ' : ''}Run supabase/migrations/0002_student_profile_management.sql in your Supabase SQL Editor to apply email updates immediately without email confirmation.`,
    );
  }
}

/** Student password login; staff accounts are rejected from the student portal. */
export async function signInStudent(email: string, password: string): Promise<void> {
  const cleanEmail = email.trim().toLowerCase();
  if (!cleanEmail || !EMAIL_RE.test(cleanEmail)) {
    throw new AppError('VALIDATION', 'Enter a valid email address.');
  }

  // If the browser currently holds an unclaimed anonymous session, clear it first.
  const current = await getAuthSession().catch(() => null);
  if (current?.user?.is_anonymous) {
    await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email: cleanEmail,
    password,
  });
  if (error) {
    if (/invalid login credentials/i.test(error.message)) {
      throw new AppError(
        'AUTH',
        'The email address or password is incorrect. Use the login email shown under My Profile → Login & Account Security. Changing your student name or matric number does not change your login credentials.',
      );
    }
    if (/email not confirmed/i.test(error.message)) {
      throw new AppError(
        'AUTH',
        'Your email is not confirmed yet. Run supabase/migrations/0001_init.sql in your Supabase SQL Editor to auto-confirm existing accounts.',
      );
    }
    throw toAppError(error);
  }
  if (!data.user) throw new AppError('AUTH', 'Student sign-in failed.');
  const { data: enrollment, error: enrollmentError } = await supabase
    .from('students')
    .select('id')
    .eq('user_id', data.user.id)
    .maybeSingle();
  if (enrollmentError) throw toAppError(enrollmentError);
  if (!enrollment) {
    await supabase.auth.signOut().catch(() => {});
    throw new AppError(
      'AUTH',
      'This login is not linked to a claimed student account. Use the Class Rep claim link first.',
    );
  }
}

/** Used by AuthProvider to distinguish claimed student accounts from staff or unclaimed sessions. */
export async function isStudentUser(userId: string): Promise<boolean> {
  const { data, error } = await supabase.from('students').select('id').eq('user_id', userId).maybeSingle();
  if (error) throw toAppError(error);
  return Boolean(data);
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) {
    // Ensure local session is always cleared even if the server token already expired.
    await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
  }
}
