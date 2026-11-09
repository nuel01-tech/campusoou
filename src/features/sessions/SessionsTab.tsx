import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAsync, useNow } from '@/hooks/useAsync';
import { listSessionsWithCounts, type SessionWithCount } from '@/services/sessions';
import { Badge, Button, EmptyState, ErrorAlert, PageLoader, SelectField } from '@/components/ui';
import { CalendarDaysIcon, CheckCircle2Icon, ClipboardCheckIcon, PlusIcon } from '@/components/icons';
import { formatDate, formatTime, isOpen, timeLeft } from '@/lib/format';
import { SEMESTER_WEEKS } from '@/lib/week';
import type { ClassRoom } from '@/types';

const ALL_COURSES = '__all__';

export function SessionsTab({ klass }: { klass: ClassRoom }) {
  const sessions = useAsync(() => listSessionsWithCounts(klass.id), [klass.id]);
  const now = useNow(30_000);
  const [selectedCourse, setSelectedCourse] = useState<string>(ALL_COURSES);
  const [selectedWeek, setSelectedWeek] = useState<number | null>(null);

  const list = sessions.data ?? [];

  const courses = useMemo(
    () => [...new Set(list.map((s) => s.course_code))].sort(),
    [list],
  );

  // Filter sessions by selected course for the 15-week grid
  const courseSessions = useMemo(
    () =>
      selectedCourse === ALL_COURSES
        ? list
        : list.filter((s) => s.course_code === selectedCourse),
    [list, selectedCourse],
  );

  // Map week number (1..15+) -> sessions held in that week
  const sessionsByWeek = useMemo(() => {
    const map = new Map<number, SessionWithCount[]>();
    for (const s of courseSessions) {
      const prev = map.get(s.week) ?? [];
      prev.push(s);
      map.set(s.week, prev);
    }
    return map;
  }, [courseSessions]);

  const filteredList = useMemo(
    () =>
      selectedWeek === null
        ? courseSessions
        : courseSessions.filter((s) => s.week === selectedWeek),
    [courseSessions, selectedWeek],
  );

  const heldWeeksCount = useMemo(
    () => SEMESTER_WEEKS.filter((w) => (sessionsByWeek.get(w)?.length ?? 0) > 0).length,
    [sessionsByWeek],
  );

  if (sessions.loading) return <PageLoader />;

  const courseParam =
    selectedCourse !== ALL_COURSES ? `&course=${encodeURIComponent(selectedCourse)}` : '';

  return (
    <div className="stack">
      {/* 15-Week Semester Overview & Omitted Week Backfill Card */}
      <section className="panel stack">
        <div className="section-head">
          <div>
            <div className="row" style={{ gap: '0.5rem' }}>
              <CalendarDaysIcon size={18} />
              <h2>15-Week Semester Tracker (Week 1 – Week 15)</h2>
            </div>
            <p className="muted small">
              Weeks with sessions are marked in green. Tap any omitted past week to create its record and manually mark student attendance.
            </p>
          </div>
          <div className="row" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
            <Badge tone="ok">{heldWeeksCount} / 15 Weeks Recorded</Badge>
            <Badge tone={15 - heldWeeksCount > 0 ? 'warn' : 'neutral'}>
              {15 - heldWeeksCount} Unrecorded
            </Badge>
          </div>
        </div>

        {courses.length > 0 && (
          <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
            <div style={{ minWidth: '220px', maxWidth: '320px', flex: 1 }}>
              <SelectField
                label="Filter 15-week tracker by course"
                value={selectedCourse}
                onChange={(e) => {
                  setSelectedCourse(e.target.value);
                  setSelectedWeek(null);
                }}
              >
                <option value={ALL_COURSES}>All courses ({list.length} sessions)</option>
                {courses.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </SelectField>
            </div>

            {selectedWeek !== null && (
              <Button variant="ghost" size="sm" onClick={() => setSelectedWeek(null)}>
                Show all weeks (clear Week {selectedWeek} filter)
              </Button>
            )}
          </div>
        )}

        <div className="semester-weeks-grid" role="list" aria-label="15 semester weeks">
          {SEMESTER_WEEKS.map((w) => {
            const weekSessions = sessionsByWeek.get(w) ?? [];
            const hasSession = weekSessions.length > 0;
            const isSelected = selectedWeek === w;
            const uniqueCourses = [...new Set(weekSessions.map((s) => s.course_code))];
            const totalPresent = weekSessions.reduce((sum, s) => sum + s.present, 0);

            return (
              <div
                key={w}
                role="listitem"
                className={[
                  'semester-week-card',
                  hasSession ? 'is-held' : 'is-omitted',
                  isSelected && 'is-selected',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => setSelectedWeek(isSelected ? null : w)}
              >
                <div className="row" style={{ justifyContent: 'space-between', gap: '0.35rem' }}>
                  <strong className="mono" style={{ fontSize: '0.88rem' }}>
                    Week {w}
                  </strong>
                  {hasSession ? (
                    <Badge tone="ok" icon={<CheckCircle2Icon size={11} />}>
                      {weekSessions.length === 1 ? '1 Session' : `${weekSessions.length} Sessions`}
                    </Badge>
                  ) : (
                    <Badge tone="neutral">No Session</Badge>
                  )}
                </div>

                {hasSession ? (
                  <div className="stack-xs" style={{ marginTop: '0.35rem' }}>
                    <span className="small font-bold" style={{ color: 'var(--text)' }}>
                      {uniqueCourses.slice(0, 2).join(', ')}
                      {uniqueCourses.length > 2 ? ` +${uniqueCourses.length - 2}` : ''}
                    </span>
                    <span className="muted" style={{ fontSize: '0.75rem' }}>
                      {totalPresent} check-in{totalPresent === 1 ? '' : 's'} recorded
                    </span>
                    <div
                      className="row"
                      style={{ marginTop: '0.25rem', gap: '0.35rem', flexWrap: 'wrap' }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {weekSessions.length === 1 ? (
                        <Link
                          to={`/rep/session/${weekSessions[0]!.id}?manual=1`}
                          className="btn btn-secondary btn-sm"
                          style={{ width: '100%', justifyContent: 'center' }}
                        >
                          <ClipboardCheckIcon size={13} />
                          <span>Open & Mark</span>
                        </Link>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          style={{ width: '100%', justifyContent: 'center' }}
                          onClick={() => setSelectedWeek(w)}
                        >
                          <span>View {weekSessions.length} Sessions</span>
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="stack-xs" style={{ marginTop: '0.35rem' }}>
                    <span className="muted" style={{ fontSize: '0.76rem' }}>
                      Omitted / unrecorded week
                    </span>
                    <div style={{ marginTop: '0.25rem' }} onClick={(e) => e.stopPropagation()}>
                      <Link
                        to={`/rep/class/${klass.id}/new-session?week=${w}&mode=backfill${courseParam}`}
                        className="btn btn-ghost btn-sm"
                        style={{
                          width: '100%',
                          justifyContent: 'center',
                          border: '1px dashed var(--border-strong)',
                        }}
                      >
                        <PlusIcon size={13} />
                        <span>Mark Week {w}</span>
                      </Link>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Lecture Sessions Table */}
      <section className="panel stack">
        <div className="section-head">
          <div>
            <h2>
              {selectedWeek !== null ? `Week ${selectedWeek} Lecture Sessions` : 'All Lecture Sessions'}
            </h2>
            <p className="muted small">
              Select any session to view check-ins, manually mark present/late/excused students, or run a batch roll-call.
            </p>
          </div>
          <div className="row" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
            <Link
              to={`/rep/class/${klass.id}/new-session?mode=backfill${selectedWeek ? `&week=${selectedWeek}` : ''}${courseParam}`}
              className="btn btn-secondary btn-sm"
            >
              <CalendarDaysIcon size={14} />
              <span>Log Past / Omitted Week</span>
            </Link>
            <Link
              to={`/rep/class/${klass.id}/new-session${selectedWeek ? `?week=${selectedWeek}${courseParam}` : ''}`}
              className="btn btn-primary btn-sm"
            >
              <PlusIcon size={14} />
              <span>Start Live Session</span>
            </Link>
          </div>
        </div>

        <ErrorAlert error={sessions.error} onRetry={() => sessions.reload()} />

        {filteredList.length === 0 && !sessions.error ? (
          <EmptyState
            title={
              selectedWeek !== null
                ? `No session recorded for Week ${selectedWeek} yet`
                : 'No sessions recorded yet'
            }
            action={
              <div className="row" style={{ justifyContent: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <Link
                  to={`/rep/class/${klass.id}/new-session?mode=backfill${selectedWeek ? `&week=${selectedWeek}` : ''}${courseParam}`}
                  className="btn btn-secondary btn-sm"
                >
                  <CalendarDaysIcon size={14} />
                  <span>
                    {selectedWeek !== null
                      ? `Manually Mark Omitted Week ${selectedWeek}`
                      : 'Log Past / Omitted Week'}
                  </span>
                </Link>
                <Link
                  to={`/rep/class/${klass.id}/new-session${selectedWeek ? `?week=${selectedWeek}${courseParam}` : ''}`}
                  className="btn btn-primary btn-sm"
                >
                  <PlusIcon size={14} />
                  <span>Start Live Session</span>
                </Link>
              </div>
            }
          >
            {selectedWeek !== null
              ? `Create a past session for Week ${selectedWeek} to manually mark the students who attended.`
              : 'Start a live GPS session when you are in the lecture room, or log a past omitted week (Week 1 – 15) to manually mark attendance.'}
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Course</th>
                  <th>Venue</th>
                  <th className="num">Week</th>
                  <th>Date & Time</th>
                  <th className="num">Present</th>
                  <th>Status</th>
                  <th className="actions-col">Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredList.map((s) => {
                  const live = isOpen(s, now);
                  return (
                    <tr key={s.id}>
                      <td>
                        <Link to={`/rep/session/${s.id}`} className="strong-link">
                          {s.course_code}
                        </Link>
                      </td>
                      <td>{s.venue}</td>
                      <td className="num mono">
                        <Badge tone="ok">Week {s.week}</Badge>
                      </td>
                      <td className="nowrap muted">
                        {formatDate(s.starts_at)}, {formatTime(s.starts_at)}
                      </td>
                      <td className="num font-bold">{s.present}</td>
                      <td>
                        {live ? (
                          <Badge tone="live">Live · {timeLeft(s.ends_at, now)}</Badge>
                        ) : (
                          <Badge tone="muted">Closed / Recorded</Badge>
                        )}
                      </td>
                      <td className="actions-col">
                        <Link to={`/rep/session/${s.id}?manual=1`} className="btn btn-secondary btn-sm">
                          <span>Mark / View</span>
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
