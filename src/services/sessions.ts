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
  is_backfill?: boolean;
  session_date?: string;
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
  const { duration_min, is_backfill, session_date, ...rest } = input;
  let starts: Date;
  let ends: Date;

  if (is_backfill) {
    // Create a closed past session for manual attendance backfill of an omitted week.
    const parsed = session_date ? new Date(`${session_date}T09:00:00`) : null;
    const nowMs = Date.now();
    if (parsed && !Number.isNaN(parsed.getTime()) && parsed.getTime() < nowMs - 120_000) {
      starts = parsed;
      ends = new Date(starts.getTime() + 60_000);
    } else {
      starts = new Date(nowMs - 120_000);
      ends = new Date(nowMs - 60_000);
    }
  } else {
    starts = new Date();
    ends = new Date(starts.getTime() + duration_min * 60_000);
  }

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

export async function updateSessionWeek(id: string, week: number): Promise<Session> {
  return unwrap(
    await supabase.from('sessions').update({ week }).eq('id', id).select().single(),
  );
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

export async function markPresent(
  sessionId: string,
  studentId: string,
  status: 'present' | 'late' | 'excused' = 'present',
  notes?: string,
): Promise<Attendance> {
  const payload: Record<string, any> = {
    session_id: sessionId,
    student_id: studentId,
    manual: true,
    status,
    notes: notes || null,
  };
  const res = await supabase.from('attendance').upsert(payload as any, { onConflict: 'session_id,student_id' }).select().single();
  if (res.error) {
    // Fallback if status/notes columns have not yet migrated
    return unwrap(
      await supabase
        .from('attendance')
        .insert({ session_id: sessionId, student_id: studentId, manual: true })
        .select()
        .single(),
    );
  }
  return res.data as Attendance;
}

export async function markBatchAttendance(
  sessionId: string,
  studentIds: string[],
  status: 'present' | 'late' | 'excused' = 'present',
): Promise<number> {
  if (studentIds.length === 0) return 0;
  const rows = studentIds.map((id) => ({
    session_id: sessionId,
    student_id: id,
    manual: true,
    distance_m: 0,
    accuracy_m: 0,
    status,
  }));
  let count = 0;
  for (const batch of chunk(rows, 200)) {
    const res = await supabase.from('attendance').upsert(batch as any, { onConflict: 'session_id,student_id' });
    if (res.error) {
      const fallback = batch.map(({ session_id, student_id, manual }) => ({ session_id, student_id, manual }));
      check(await supabase.from('attendance').upsert(fallback as any, { onConflict: 'session_id,student_id' }));
    }
    count += batch.length;
  }
  return count;
}

export interface LiveCampusSession {
  id: string;
  class_id: string;
  class_name: string;
  department_name: string | null;
  level: string | null;
  course_code: string;
  venue: string;
  starts_at: string;
  ends_at: string;
  radius_m: number;
  present_count: number;
}

export async function listLiveCampusSessions(): Promise<LiveCampusSession[]> {
  try {
    const nowIso = new Date().toISOString();
    const { data, error } = await supabase
      .from('sessions')
      .select('*, classes(name, level, departments(name)), attendance(count)')
      .lte('starts_at', nowIso)
      .gte('ends_at', nowIso)
      .order('starts_at', { ascending: false });

    if (error || !data) return [];

    return data.map((row: any) => ({
      id: row.id,
      class_id: row.class_id,
      class_name: row.classes?.name ?? 'Class',
      department_name: row.classes?.departments?.name ?? null,
      level: row.classes?.level ?? null,
      course_code: row.course_code,
      venue: row.venue,
      starts_at: row.starts_at,
      ends_at: row.ends_at,
      radius_m: row.radius_m,
      present_count: row.attendance?.[0]?.count ?? 0,
    }));
  } catch {
    return [];
  }
}

export async function removeAttendance(id: string): Promise<void> {
  check(await supabase.from('attendance').delete().eq('id', id));
}
