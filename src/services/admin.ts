import { supabase } from './db';
import { createIsolatedClient } from '@/lib/supabase';
import { AppError, check, toAppError, unwrap } from '@/lib/errors';
import type { Department, Profile, RepSummary } from '@/types';

export async function listDepartments(): Promise<Department[]> {
  const { data, error } = await supabase.rpc('list_departments');
  if (error) {
    // Fallback to direct select if the list_departments RPC has not been applied yet
    const direct = await supabase.from('departments').select('id, name, created_at').order('name');
    if (!direct.error && direct.data) {
      return direct.data.map((d) => ({
        id: String(d.id),
        name: String(d.name),
        created_at: String(d.created_at),
        rep_count: 0,
      }));
    }
    throw toAppError(error);
  }
  return ((data as Department[] | null) ?? []).map((d) => ({
    ...d,
    rep_count: Number(d.rep_count ?? 0),
  }));
}

export async function createDepartment(name: string): Promise<Department> {
  const clean = name.trim();
  const row = unwrap<Omit<Department, 'rep_count'>>(
    await supabase.rpc('create_department', { p_name: clean }),
  );
  return { ...row, rep_count: 0 };
}

export async function deleteDepartment(departmentId: string): Promise<void> {
  check(await supabase.rpc('delete_department', { p_department_id: departmentId }));
}

export async function listReps(): Promise<RepSummary[]> {
  const { data, error } = await supabase.rpc('list_reps');
  if (error) throw toAppError(error);
  return ((data as RepSummary[] | null) ?? []).map((r) => ({
    ...r,
    department_id: r.department_id ?? null,
    department_name: r.department_name ?? null,
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
  department_id: string | null;
}): Promise<void> {
  const email = input.email.trim().toLowerCase();
  const full_name = input.full_name.trim();
  const department_id = input.department_id || null;

  const { error: rpcErr } = await supabase.rpc('admin_create_rep', {
    p_full_name: full_name,
    p_email: email,
    p_password: input.password,
    p_department_id: department_id,
  });

  if (!rpcErr) return;

  const mapped = toAppError(rpcErr);
  if (mapped.code !== 'DB_NOT_MIGRATED') {
    throw mapped;
  }

  check(
    await supabase.rpc('pre_authorize_rep', {
      p_email: email,
      p_full_name: full_name,
      p_department_id: department_id,
    }),
  );

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
