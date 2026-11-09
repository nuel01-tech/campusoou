const DAY_MS = 86_400_000;

/** All 15 academic weeks in a standard university semester (Week 1 – Week 15). */
export const SEMESTER_WEEKS = Array.from({ length: 15 }, (_, i) => i + 1);

/**
 * Teaching week for a date, counting the week containing `semesterStart` as
 * week 1. Returns null when no start date is set. Clamped to 1..52.
 */
export function weekFor(date: Date, semesterStart: string | null): number | null {
  if (!semesterStart) return null;
  const start = new Date(`${semesterStart}T00:00:00`);
  if (Number.isNaN(start.getTime())) return null;
  const days = Math.floor((startOfDay(date).getTime() - start.getTime()) / DAY_MS);
  const week = Math.floor(days / 7) + 1;
  return Math.min(52, Math.max(1, week));
}

/**
 * Returns the YYYY-MM-DD date corresponding to the start of `week` (1-based)
 * when `semesterStart` is set, or null otherwise.
 */
export function dateForSemesterWeek(week: number, semesterStart: string | null): string | null {
  if (!semesterStart || week < 1) return null;
  const start = new Date(`${semesterStart}T00:00:00`);
  if (Number.isNaN(start.getTime())) return null;
  const target = new Date(start.getTime() + (week - 1) * 7 * DAY_MS);
  const y = target.getFullYear();
  const m = String(target.getMonth() + 1).padStart(2, '0');
  const d = String(target.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
