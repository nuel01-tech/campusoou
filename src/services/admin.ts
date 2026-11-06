import { supabase } from './db';
import { createIsolatedClient } from '@/lib/supabase';
import { AppError, check, toAppError, unwrap } from '@/lib/errors';
import type { Profile, RepSummary } from '@/types';

export async function listReps(): Promise<RepSummary[]> {
  const { data, error } = await supabase.rpc('list_reps');
  if (error) throw toAppError(error);
  return ((data as RepSummary[] | null) ?? []).map((r) => ({
    ...r,
    class_count: Number(r.class_count ?? 0),
    student_count: Number(r.student_count ?? 0),
  }));
}

/**
 * Creates a Class Rep account as the Super Admin.
 *
 * Uses the `admin_create_rep` database RPC first (creates the user directly
 * inside Postgres without triggering SMTP confirmation emails or 503 errors).
 * Falls back to `pre_authorize_rep` + isolated `auth.signUp` only if the latest
 * SQL migration has not been applied yet.
 */
export async function createRepAccount(input: {
  full_name: string;
  email: string;
  password: string;
}): Promise<void> {
  const email = input.email.trim().toLowerCase();
  const full_name = input.full_name.trim();

  const { error: rpcErr } = await supabase.rpc('admin_create_rep', {
    p_full_name: full_name,
    p_email: email,
    p_password: input.password,
  });

  if (!rpcErr) return;

  const mapped = toAppError(rpcErr);
  if (mapped.code !== 'DB_NOT_MIGRATED') {
    throw mapped;
  }

  check(await supabase.rpc('pre_authorize_rep', { p_email: email, p_full_name: full_name }));

  const isolated = createIsolatedClient();
  const { error } = await isolated.auth.signUp({
    email,
    password: input.password,
    options: { data: { full_name } },
  });

  if (error) {
    if (/already registered/i.test(error.message)) {
      throw new AppError('REP_EXISTS', 'An account with that email already exists.');
    }
    throw toAppError(error);
  }
}

export async function setRepActive(repId: string, active: boolean): Promise<Profile> {
  return unwrap(await supabase.rpc('set_rep_active', { p_rep_id: repId, p_active: active }));
}

export async function deleteRep(repId: string): Promise<void> {
  check(await supabase.rpc('delete_rep', { p_rep_id: repId }));
}
