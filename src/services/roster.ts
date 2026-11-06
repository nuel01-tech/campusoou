import { chunk, fetchAll, supabase } from './db';
import { check, unwrap } from '@/lib/errors';
import { normalizeMatric, normalizeName } from '@/lib/names';
import type { RosterEntry, Student } from '@/types';

export async function listStudents(classId: string): Promise<Student[]> {
  return fetchAll<Student>(() =>
    supabase.from('students').select('*').eq('class_id', classId).order('full_name'),
  );
}

/**
 * Adds new students and updates names of existing ones (matched by matric
 * number). Existing claims are preserved. Returns the number of rows written.
 */
export async function importRoster(classId: string, entries: RosterEntry[]): Promise<number> {
  const rows = entries.map((e) => ({
    class_id: classId,
    full_name: normalizeName(e.full_name),
    matric_no: normalizeMatric(e.matric_no),
  }));
  let written = 0;
  for (const batch of chunk(rows, 500)) {
    check(await supabase.from('students').upsert(batch, { onConflict: 'class_id,matric_no' }));
    written += batch.length;
  }
  return written;
}

export async function addStudent(classId: string, entry: RosterEntry): Promise<Student> {
  return unwrap(
    await supabase
      .from('students')
      .insert({ class_id: classId, full_name: normalizeName(entry.full_name), matric_no: normalizeMatric(entry.matric_no) })
      .select()
      .single(),
  );
}

export async function deleteStudent(id: string): Promise<void> {
  check(await supabase.from('students').delete().eq('id', id));
}

/** Toggles suspension for a student. Suspended students cannot check in. */
export async function setStudentSuspended(id: string, suspended: boolean): Promise<Student> {
  return unwrap(
    await supabase.from('students').update({ suspended }).eq('id', id).select().single(),
  );
}

/** Unlinks the student's phone and passkey so they can claim again on a new device. */
export async function resetClaim(id: string): Promise<Student> {
  return unwrap(
    await supabase
      .from('students')
      .update({
        user_id: null,
        claimed_at: null,
        passkey_id: null,
        device_token: null,
      } as any)
      .eq('id', id)
      .select()
      .single(),
  );
}
