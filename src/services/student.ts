/** Data access used by the student-facing pages. */
import { supabase } from './db';
import { AppError, appError, toAppError, unwrap } from '@/lib/errors';
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
  const cleanName = fullName.trim().replace(/\s+/g, ' ');
  const cleanMatric = matricNo.trim().toUpperCase().replace(/\s+/g, '');

  if (cleanName.length < 2 || cleanName.length > 160) {
    throw new AppError('VALIDATION', 'Enter your full name (between 2 and 160 characters).');
  }
  if (cleanMatric.length < 2 || cleanMatric.length > 40) {
    throw new AppError('VALIDATION', 'Enter a valid matric number (between 2 and 40 characters).');
  }

  const { data, error } = await supabase.rpc('update_my_student_profile', {
    p_full_name: cleanName,
    p_matric_no: cleanMatric,
  });
  if (error) {
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
  // Prefer the coordinate-masked server RPC so session lat/lng and security_code
  // are never transmitted to student browsers (defeating DevTools coordinate inspection).
  const rpcRes = await supabase.rpc('list_open_student_sessions', { p_class_id: classId });
  if (!rpcRes.error && Array.isArray(rpcRes.data)) {
    return rpcRes.data as Session[];
  }

  const now = new Date().toISOString();
  const rows = unwrap(
    await supabase
      .from('sessions')
      .select('id, class_id, course_code, venue, radius_m, week, starts_at, ends_at, security_code, created_at')
      .eq('class_id', classId)
      .lte('starts_at', now)
      .gt('ends_at', now)
      .order('starts_at', { ascending: false }),
  );
  return (rows as Partial<Session>[]).map((s) => ({
    ...(s as Session),
    lat: 0,
    lng: 0,
    requires_code: Boolean(s.security_code && String(s.security_code).trim().length > 0),
    security_code: null,
  }));
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
  webauthnProof?: string,
  securityCode?: string,
): Promise<Attendance> {
  const { data, error } = await supabase.rpc('check_in', {
    p_session_id: sessionId,
    p_lat: fix.lat,
    p_lng: fix.lng,
    p_accuracy: fix.accuracy,
    p_passkey_id: passkeyId,
    p_device_token: deviceToken,
    p_webauthn_proof: webauthnProof ?? null,
    p_security_code: securityCode?.trim() || null,
  });

  if (error) {
    const msg = String((error as { message?: string }).message ?? '');
    if (/could not find the function|PGRST202/i.test(msg)) {
      const fallback = await supabase.rpc('check_in', {
        p_session_id: sessionId,
        p_lat: fix.lat,
        p_lng: fix.lng,
        p_accuracy: fix.accuracy,
        p_passkey_id: passkeyId,
        p_device_token: deviceToken,
      });
      if (fallback.error) throw toAppError(fallback.error);
      return fallback.data as Attendance;
    }
    throw toAppError(error);
  }
  return data as Attendance;
}
