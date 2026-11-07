/** Data access used by the student-facing pages. */
import { supabase } from './db';
import { appError, toAppError, unwrap } from '@/lib/errors';
import type { Attendance, GeoFix, Session, Student } from '@/types';

export interface MyEnrollment {
  student: Student;
  className: string;
}

export interface MyCheckIn extends Attendance {
  session: Pick<Session, 'course_code' | 'venue' | 'week' | 'starts_at'> | null;
}

export async function findClassByCode(code: string): Promise<{ id: string; name: string }> {
  const { data, error } = await supabase.rpc('get_class_by_code', { p_code: code });
  if (error) throw toAppError(error);
  const row = (data as { id: string; name: string }[] | null)?.[0];
  if (!row) throw appError('CLASS_NOT_FOUND');
  return row;
}

/** The roster entry linked to this device, or null if not claimed yet. */
export async function getMyEnrollment(): Promise<MyEnrollment | null> {
  const { data, error } = await supabase
    .from('students')
    .select('*, classes(name)')
    .maybeSingle();
  if (error) throw toAppError(error);
  if (!data) return null;
  const { classes, ...student } = data as Student & { classes: { name: string } | null };
  return { student, className: classes?.name ?? '' };
}

export async function claimStudent(
  code: string,
  matric: string,
  name: string,
  passkeyId: string,
  deviceToken: string,
): Promise<Student> {
  const { data, error } = await supabase.rpc('claim_student', {
    p_code: code,
    p_matric: matric,
    p_name: name,
    p_passkey_id: passkeyId,
    p_device_token: deviceToken,
  });
  if (error) throw toAppError(error);
  return data as Student;
}

export async function updateMyStudentProfile(fullName: string, matricNo: string): Promise<Student> {
  const { data, error } = await supabase.rpc('update_my_student_profile', {
    p_full_name: fullName.trim(),
    p_matric_no: matricNo.trim(),
  });
  if (error) {
    if (/MATRIC_CHANGE_COOLDOWN/i.test(error.message)) throw new Error(error.message);
    if (/MATRIC_ALREADY_IN_USE/i.test(error.message)) throw new Error('That matric number is already registered in your class.');
    throw toAppError(error);
  }
  return data as Student;
}

export async function bindStudentPasskey(passkeyId: string, deviceToken: string): Promise<Student> {
  const { data, error } = await supabase.rpc('bind_student_passkey', {
    p_passkey_id: passkeyId,
    p_device_token: deviceToken,
  });
  if (error) throw toAppError(error);
  return data as Student;
}

export async function listOpenSessions(classId: string): Promise<Session[]> {
  const now = new Date().toISOString();
  return unwrap(
    await supabase
      .from('sessions')
      .select('*')
      .eq('class_id', classId)
      .lte('starts_at', now)
      .gt('ends_at', now)
      .order('starts_at', { ascending: false }),
  );
}

export async function listMyCheckIns(limit = 30): Promise<MyCheckIn[]> {
  const rows = unwrap(
    await supabase
      .from('attendance')
      .select('*, session:sessions(course_code, venue, week, starts_at)')
      .order('checked_in_at', { ascending: false })
      .limit(limit),
  );
  return rows as MyCheckIn[];
}

export async function checkIn(
  sessionId: string,
  fix: GeoFix,
  passkeyId: string,
  deviceToken: string,
): Promise<Attendance> {
  const { data, error } = await supabase.rpc('check_in', {
    p_session_id: sessionId,
    p_lat: fix.lat,
    p_lng: fix.lng,
    p_accuracy: fix.accuracy,
    p_passkey_id: passkeyId,
    p_device_token: deviceToken,
  });
  if (error) throw toAppError(error);
  return data as Attendance;
}
