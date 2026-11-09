/**
  * Builds the export sheet: one row per student, one column per week.
  *
  * A week with one session shows "P" or "A". When a course meets more than
  * once in a week the cell shows attended/held, e.g. "1/2".
  * When `options.allSemesterWeeks` is true, all 15 semester weeks (Week 1 – Week 15)
  * are included as columns; weeks without sessions show "—" and do not inflate `Held`.
  */
import { SEMESTER_WEEKS } from '@/lib/week';
import type { Attendance, Session, Student } from '@/types';

export interface AttendanceMatrix {
  header: string[];
  rows: (string | number)[][];
  weeks: number[];
  heldWeeks: Set<number>;
}

export interface BuildMatrixOptions {
  allSemesterWeeks?: boolean;
}

export function buildMatrix(
  students: Student[],
  sessions: Session[],
  attendance: Attendance[],
  options?: BuildMatrixOptions,
): AttendanceMatrix {
  const sessionWeeks = [...new Set(sessions.map((s) => s.week))].sort((a, b) => a - b);
  const heldWeeks = new Set<number>(sessionWeeks);

  const weeks = options?.allSemesterWeeks
    ? [...new Set([...SEMESTER_WEEKS, ...sessionWeeks])].sort((a, b) => a - b)
    : sessionWeeks;

  const sessionsPerWeek = new Map<number, number>();
  const weekOfSession = new Map<string, number>();
  for (const s of sessions) {
    sessionsPerWeek.set(s.week, (sessionsPerWeek.get(s.week) ?? 0) + 1);
    weekOfSession.set(s.id, s.week);
  }

  // student -> week -> sessions attended
  const attended = new Map<string, Map<number, number>>();
  for (const a of attendance) {
    const week = weekOfSession.get(a.session_id);
    if (week === undefined) continue;
    let byWeek = attended.get(a.student_id);
    if (!byWeek) attended.set(a.student_id, (byWeek = new Map()));
    byWeek.set(week, (byWeek.get(week) ?? 0) + 1);
  }

  const totalHeld = sessions.length;
  const header = ['S/N', 'Name', 'Matric No', ...weeks.map((w) => `Week ${w}`), 'Attended', 'Held', '%'];

  const sorted = [...students].sort((a, b) => a.full_name.localeCompare(b.full_name));
  const rows = sorted.map((st, i) => {
    const byWeek = attended.get(st.id);
    let total = 0;
    const cells = weeks.map((w) => {
      const held = sessionsPerWeek.get(w) ?? 0;
      if (held === 0) return '—';
      const got = Math.min(byWeek?.get(w) ?? 0, held);
      total += got;
      if (held === 1) return got ? 'P' : 'A';
      return `${got}/${held}`;
    });
    const pct = totalHeld ? Math.round((total / totalHeld) * 100) : 0;
    return [i + 1, st.full_name, st.matric_no, ...cells, total, totalHeld, pct];
  });

  return { header, rows, weeks, heldWeeks };
}
