/** Domain types. These mirror the tables in supabase/migrations/0001_init.sql. */

export type StaffRole = 'super_admin' | 'rep';

export interface Department {
  id: string;
  name: string;
  created_at: string;
  rep_count: number;
}

export const ACADEMIC_LEVELS = [
  '100L',
  '200L',
  '300L',
  '400L',
  '500L',
  '600L',
  'Postgraduate (PG)',
] as const;

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: StaffRole;
  department_id?: string | null;
  level?: string | null;
  active: boolean;
  created_at: string;
}

export interface RepSummary {
  id: string;
  email: string;
  full_name: string;
  department_id: string | null;
  department_name: string | null;
  level: string | null;
  active: boolean;
  created_at: string;
  class_count: number;
  student_count: number;
}

export interface ClassRoom {
  id: string;
  owner_id: string;
  name: string;
  department_id?: string | null;
  department_name?: string | null;
  level?: string | null;
  join_code: string;
  semester_start: string | null; // ISO date (yyyy-mm-dd)
  created_at: string;
}

export interface Student {
  id: string;
  class_id: string;
  full_name: string;
  matric_no: string;
  user_id: string | null;
  passkey_id?: string | null;
  device_token?: string | null;
  claimed_at: string | null;
  matric_changed_at?: string | null;
  is_rep?: boolean;
  suspended: boolean;
  created_at: string;
}

export interface Session {
  id: string;
  class_id: string;
  course_code: string;
  venue: string;
  lat: number;
  lng: number;
  radius_m: number;
  week: number;
  starts_at: string;
  ends_at: string;
  created_at: string;
}

export type AttendanceStatus = 'present' | 'late' | 'excused';

export interface Attendance {
  id: string;
  session_id: string;
  student_id: string;
  checked_in_at: string;
  distance_m: number | null;
  accuracy_m: number | null;
  manual: boolean;
  status?: AttendanceStatus;
  notes?: string | null;
}

/** A roster row before it is saved. */
export interface RosterEntry {
  full_name: string;
  matric_no: string;
  is_rep?: boolean;
}

export interface GeoFix {
  lat: number;
  lng: number;
  accuracy: number;
}
