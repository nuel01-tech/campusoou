import { chunk, fetchAll, supabase } from './db';
import { listStudents } from './roster';
import { check, unwrap } from '@/lib/errors';
import type { Attendance, Session, Student } from '@/types';

export interface NewSession {
  class_id: string;
  course_code: string;
  venue: string;
  lat: number;
  lng: number;
  radius_m: number;
  week: number;
  duration_min: number;
}

export async function listSessions(classId: string): Promise<Session[]> {
  return fetchAll<Session>(() =>
    supabase.from('sessions').select('*').eq('class_id', classId).order('starts_at', { ascending: false }),
  );
}

export async function getSession(id: string): Promise<Session> {
  return unwrap(await supabase.from('sessions').select('*').eq('id', id).single());
}

export interface SessionWithCount extends Session {
  present: number;
}

export async function listSessionsWithCounts(classId: string): Promise<SessionWithCount[]> {
  const rows = await fetchAll<Session & { attendance: { count: number }[] }>(() =>
    supabase
      .from('sessions')
      .select('*, attendance(count)')
      .eq('class_id', classId)
      .order('starts_at', { ascending: false }),
  );
  return rows.map(({ attendance, ...s }) => ({ ...s, present: attendance[0]?.count ?? 0 }));
}

/**
 * Automatically marks all non-suspended Class Reps in `classId` as present for `sessionId`.
 */
export async function autoMarkClassRepsForSession(
  sessionId: string,
  classId: string,
  studentsList?: Student[],
): Promise<Attendance[]> {
  try {
    const students = studentsList ?? (await listStudents(classId));
    const repStudents = students.filter((s) => s.is_rep && !s.suspended);
    if (repStudents.length === 0) return [];

    const payload = repStudents.map((rep) => ({
      session_id: sessionId,
      student_id: rep.id,
      distance_m: 0,
      accuracy_m: 0,
      manual: false,
    }));

    const { data } = await supabase
      .from('attendance')
      .upsert(payload as any, { onConflict: 'session_id,student_id', ignoreDuplicates: true })
      .select();

    return (data as Attendance[] | null) ?? [];
  } catch {
    return [];
  }
}

export async function createSession(input: NewSession): Promise<Session> {
  const { duration_min, ...rest } = input;
  const starts = new Date();
  const ends = new Date(starts.getTime() + duration_min * 60_000);
  const session = unwrap<Session>(
    await supabase
      .from('sessions')
      .insert({ ...rest, starts_at: starts.toISOString(), ends_at: ends.toISOString() })
      .select()
      .single(),
  );
  await autoMarkClassRepsForSession(session.id, session.class_id);
  return session;
}

export async function closeSession(id: string): Promise<Session> {
  return unwrap(
    await supabase.from('sessions').update({ ends_at: new Date().toISOString() }).eq('id', id).select().single(),
  );
}

export async function extendSession(session: Session, minutes: number): Promise<Session> {
  const base = Math.max(Date.now(), new Date(session.ends_at).getTime());
  return unwrap(
    await supabase
      .from('sessions')
      .update({ ends_at: new Date(base + minutes * 60_000).toISOString() })
      .eq('id', session.id)
      .select()
      .single(),
  );
}

export async function deleteSession(id: string): Promise<void> {
  check(await supabase.from('sessions').delete().eq('id', id));
}

// --- attendance ------------------------------------------------------------

export async function listAttendance(sessionId: string): Promise<Attendance[]> {
  return fetchAll<Attendance>(() =>
    supabase.from('attendance').select('*').eq('session_id', sessionId).order('checked_in_at'),
  );
}

export async function listAttendanceFor(sessionIds: string[]): Promise<Attendance[]> {
  const out: Attendance[] = [];
  // Keep the IN (...) list short enough for a URL.
  for (const ids of chunk(sessionIds, 100)) {
    out.push(...(await fetchAll<Attendance>(() => supabase.from('attendance').select('*').in('session_id', ids))));
  }
  return out;
}

export async function markPresent(sessionId: string, studentId: string): Promise<Attendance> {
  return unwrap(
    await supabase
      .from('attendance')
      .insert({ session_id: sessionId, student_id: studentId, manual: true })
      .select()
      .single(),
  );
}

export async function removeAttendance(id: string): Promise<void> {
  check(await supabase.from('attendance').delete().eq('id', id));
}
