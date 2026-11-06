import { chunk, fetchAll, supabase } from './db';
import { check, unwrap } from '@/lib/errors';
import { namesMatch, normalizeMatric, normalizeName } from '@/lib/names';
import type { RosterEntry, Student } from '@/types';

const LOCAL_REP_MAP_KEY = 'campuspulse_rep_students_v1';

function readLocalRepMap(classId: string): Record<string, boolean> {
  try {
    const raw = window.localStorage.getItem(LOCAL_REP_MAP_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, Record<string, boolean>>;
    return parsed[classId] ?? {};
  } catch {
    return {};
  }
}

function writeLocalRepFlag(classId: string, studentId: string, isRep: boolean): void {
  try {
    const raw = window.localStorage.getItem(LOCAL_REP_MAP_KEY);
    const parsed: Record<string, Record<string, boolean>> = raw ? JSON.parse(raw) : {};
    parsed[classId] = { ...(parsed[classId] ?? {}), [studentId]: isRep };
    window.localStorage.setItem(LOCAL_REP_MAP_KEY, JSON.stringify(parsed));
  } catch {
    // Ignore storage errors
  }
}

async function getCurrentRepNames(): Promise<string[]> {
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const user = sessionData.session?.user;
    if (!user) return [];
    const names = new Set<string>();
    const metaName = user.user_metadata?.full_name as string | undefined;
    if (metaName) names.add(metaName);
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', user.id)
      .maybeSingle();
    if (profile?.full_name) names.add(profile.full_name);
    return Array.from(names);
  } catch {
    return [];
  }
}

export async function listStudents(classId: string): Promise<Student[]> {
  const [rows, repNames] = await Promise.all([
    fetchAll<Student>(() =>
      supabase.from('students').select('*').eq('class_id', classId).order('full_name'),
    ),
    getCurrentRepNames(),
  ]);
  const localMap = readLocalRepMap(classId);

  return rows.map((s) => {
    const localOverride = localMap[s.id];
    const matchedByName = repNames.some((repName) => namesMatch(s.full_name, repName));
    const isRep =
      typeof localOverride === 'boolean'
        ? localOverride
        : Boolean(s.is_rep) || matchedByName;
    return { ...s, is_rep: isRep };
  });
}

/**
 * Ensures all non-suspended Class Rep students in `classId` are marked present
 * across all existing sessions for that class.
 */
export async function backfillRepAttendanceForClass(
  classId: string,
  studentsList?: Student[],
): Promise<void> {
  try {
    const students = studentsList ?? (await listStudents(classId));
    const repStudents = students.filter((s) => s.is_rep && !s.suspended);
    if (repStudents.length === 0) return;

    const { data: sessions } = await supabase
      .from('sessions')
      .select('id')
      .eq('class_id', classId);
    if (!sessions || sessions.length === 0) return;

    const rowsToInsert: {
      session_id: string;
      student_id: string;
      distance_m: number;
      accuracy_m: number;
      manual: boolean;
    }[] = [];

    for (const sess of sessions) {
      for (const rep of repStudents) {
        rowsToInsert.push({
          session_id: sess.id,
          student_id: rep.id,
          distance_m: 0,
          accuracy_m: 0,
          manual: false,
        });
      }
    }

    for (const batch of chunk(rowsToInsert, 200)) {
      await supabase
        .from('attendance')
        .upsert(batch as any, { onConflict: 'session_id,student_id', ignoreDuplicates: true });
    }
  } catch {
    // Non-fatal fallback; DB triggers also handle this when migration is applied.
  }
}

/**
 * Adds new students and updates names of existing ones (matched by matric
 * number). Existing claims are preserved. Automatically detects Class Reps and
 * marks them present across sessions. Returns the number of rows written.
 */
export async function importRoster(classId: string, entries: RosterEntry[]): Promise<number> {
  const repNames = await getCurrentRepNames();
  const rows = entries.map((e) => {
    const fullName = normalizeName(e.full_name);
    const matricNo = normalizeMatric(e.matric_no);
    const isRep = Boolean(e.is_rep) || repNames.some((rn) => namesMatch(fullName, rn));
    return {
      class_id: classId,
      full_name: fullName,
      matric_no: matricNo,
      ...(isRep ? { is_rep: true } : {}),
    };
  });
  let written = 0;
  for (const batch of chunk(rows, 500)) {
    const res = await supabase.from('students').upsert(batch as any, { onConflict: 'class_id,matric_no' });
    if (res.error) {
      // Fallback if `is_rep` column has not yet been migrated in Supabase
      const fallbackBatch = batch.map(({ class_id, full_name, matric_no }) => ({
        class_id,
        full_name,
        matric_no,
      }));
      check(await supabase.from('students').upsert(fallbackBatch, { onConflict: 'class_id,matric_no' }));
    }
    written += batch.length;
  }
  await backfillRepAttendanceForClass(classId);
  return written;
}

export async function addStudent(classId: string, entry: RosterEntry): Promise<Student> {
  const repNames = await getCurrentRepNames();
  const fullName = normalizeName(entry.full_name);
  const matricNo = normalizeMatric(entry.matric_no);
  const isRep = Boolean(entry.is_rep) || repNames.some((rn) => namesMatch(fullName, rn));

  const res = await supabase
    .from('students')
    .insert({ class_id: classId, full_name: fullName, matric_no: matricNo, is_rep: isRep } as any)
    .select()
    .single();

  let student: Student;
  if (res.error) {
    student = unwrap(
      await supabase
        .from('students')
        .insert({ class_id: classId, full_name: fullName, matric_no: matricNo })
        .select()
        .single(),
    );
  } else {
    student = res.data as Student;
  }

  if (isRep) {
    writeLocalRepFlag(classId, student.id, true);
    student = { ...student, is_rep: true };
    await backfillRepAttendanceForClass(classId, [student]);
  }
  return student;
}

/** Toggles whether a student is designated as a Class Rep (auto-marked present in all sessions). */
export async function setStudentRep(student: Student, isRep: boolean): Promise<Student> {
  writeLocalRepFlag(student.class_id, student.id, isRep);
  const res = await supabase
    .from('students')
    .update({ is_rep: isRep } as any)
    .eq('id', student.id)
    .select()
    .single();

  const updated: Student = res.error
    ? { ...student, is_rep: isRep }
    : { ...(res.data as Student), is_rep: isRep };

  if (isRep && !updated.suspended) {
    await backfillRepAttendanceForClass(updated.class_id, [updated]);
  }
  return updated;
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
