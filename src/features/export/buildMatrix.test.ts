import { describe, expect, it } from 'vitest';
import { buildMatrix } from './buildMatrix';
import type { Attendance, Session, Student } from '@/types';

const student = (id: string, full_name: string, matric_no: string): Student => ({
  id,
  class_id: 'c1',
  full_name,
  matric_no,
  user_id: null,
  claimed_at: null,
  suspended: false,
  created_at: '',
});

const session = (id: string, week: number): Session => ({
  id,
  class_id: 'c1',
  course_code: 'CSC 301',
  venue: 'LT1',
  lat: 0,
  lng: 0,
  radius_m: 50,
  week,
  starts_at: '',
  ends_at: '',
  created_at: '',
});

const present = (session_id: string, student_id: string): Attendance => ({
  id: `${session_id}-${student_id}`,
  session_id,
  student_id,
  checked_in_at: '',
  distance_m: 10,
  accuracy_m: 5,
  manual: false,
});

describe('buildMatrix', () => {
  it('places students on rows sorted by name and weeks across columns', () => {
    const students = [student('s2', 'Zainab Ali', 'M2'), student('s1', 'Adeola Cole', 'M1')];
    const sessions = [session('w1', 1), session('w2a', 2), session('w2b', 2)];
    const attendance = [present('w1', 's1'), present('w2a', 's1'), present('w2b', 's2')];

    const m = buildMatrix(students, sessions, attendance);

    expect(m.header).toEqual(['S/N', 'Name', 'Matric No', 'Week 1', 'Week 2', 'Attended', 'Held', '%']);
    expect(m.rows).toEqual([
      [1, 'Adeola Cole', 'M1', 'P', '1/2', 2, 3, 67],
      [2, 'Zainab Ali', 'M2', 'A', '1/2', 1, 3, 33],
    ]);
  });

  it('includes all 15 semester weeks when allSemesterWeeks is enabled and leaves unmarked past/upcoming weeks blank', () => {
    const students = [student('s1', 'Adeola Cole', 'M1')];
    const sessions = [session('w3', 3)];
    const attendance = [present('w3', 's1')];

    const m = buildMatrix(students, sessions, attendance, { allSemesterWeeks: true });

    expect(m.weeks).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    expect(m.heldWeeks.has(3)).toBe(true);
    expect(m.heldWeeks.has(1)).toBe(false);
    expect(m.rows[0]).toEqual([
      1,
      'Adeola Cole',
      'M1',
      '',  // W1 (past week not marked -> blank)
      '',  // W2 (past week not marked -> blank)
      'P', // W3 (marked week)
      '',  // W4 (upcoming week -> blank)
      '',  // W5
      '',  // W6
      '',  // W7
      '',  // W8
      '',  // W9
      '',  // W10
      '',  // W11
      '',  // W12
      '',  // W13
      '',  // W14
      '',  // W15
      1,   // Attended
      1,   // Held
      100, // %
    ]);
  });
});
