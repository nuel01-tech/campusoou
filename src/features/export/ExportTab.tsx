import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAction, useAsync } from '@/hooks/useAsync';
import { listStudents } from '@/services/roster';
import { listAttendanceFor, listSessions } from '@/services/sessions';
import { Badge, Button, ErrorAlert, PageLoader, SelectField } from '@/components/ui';
import { CheckCircle2Icon, DownloadIcon, FileSpreadsheetIcon, PlusIcon, PrinterIcon } from '@/components/icons';
import { buildMatrix } from './buildMatrix';
import { downloadMatrix, type ExportFormat } from './downloadMatrix';
import type { ClassRoom } from '@/types';

const ALL = '__all__';

export function ExportTab({ klass }: { klass: ClassRoom }) {
  const base = useAsync(
    async () => {
      const [students, sessions] = await Promise.all([listStudents(klass.id), listSessions(klass.id)]);
      return { students, sessions };
    },
    [klass.id],
  );

  const courses = useMemo(
    () => [...new Set((base.data?.sessions ?? []).map((s) => s.course_code))].sort(),
    [base.data],
  );
  const [picked, setPicked] = useState<string | null>(null);
  const [showAll15Weeks, setShowAll15Weeks] = useState<boolean>(true);
  const course = picked ?? courses[0] ?? ALL;

  const sessions = useMemo(
    () => (base.data?.sessions ?? []).filter((s) => course === ALL || s.course_code === course),
    [base.data, course],
  );
  const sessionKey = sessions.map((s) => s.id).join(',');

  const attendance = useAsync(
    () => (sessions.length ? listAttendanceFor(sessions.map((s) => s.id)) : Promise.resolve([])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessionKey],
  );

  const matrix = useMemo(
    () =>
      base.data && attendance.data
        ? buildMatrix(base.data.students, sessions, attendance.data, {
            allSemesterWeeks: showAll15Weeks,
          })
        : null,
    [base.data, sessions, attendance.data, showAll15Weeks],
  );

  const download = useAction(async (format: ExportFormat) => {
    if (!matrix) return;
    const label = course === ALL ? 'All courses' : course;
    await downloadMatrix(matrix, `${klass.name} ${label} attendance`, format);
  });

  if (base.loading) return <PageLoader />;
  if (base.error) return <ErrorAlert error={base.error} onRetry={() => base.reload()} />;

  const courseParam = course !== ALL ? `&course=${encodeURIComponent(course)}` : '';

  return (
    <div className="panel stack">
      <div className="export-bar">
        <div className="row" style={{ gap: '0.75rem', flexWrap: 'wrap', flex: 1 }}>
          <div style={{ minWidth: '210px' }}>
            <SelectField
              label="Course filter"
              value={course}
              onChange={(e) => setPicked(e.target.value)}
            >
              {courses.length === 0 && <option value={ALL}>All courses (no sessions yet)</option>}
              {courses.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
              {courses.length > 1 && <option value={ALL}>All courses combined</option>}
            </SelectField>
          </div>

          <div className="stack-xs">
            <span className="field-label">Semester Week Columns</span>
            <div className="segmented" role="tablist" aria-label="Week columns mode">
              <button
                type="button"
                role="tab"
                aria-selected={showAll15Weeks}
                className={showAll15Weeks ? 'is-active' : ''}
                onClick={() => setShowAll15Weeks(true)}
              >
                All 15 Weeks (Week 1 – 15)
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={!showAll15Weeks}
                className={!showAll15Weeks ? 'is-active' : ''}
                onClick={() => setShowAll15Weeks(false)}
                disabled={sessions.length === 0}
              >
                Recorded Weeks Only ({new Set(sessions.map((s) => s.week)).size})
              </button>
            </div>
          </div>
        </div>

        <div className="row no-print" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
          <Button
            onClick={() => download.run('xlsx')}
            disabled={!matrix || attendance.loading}
            loading={download.pending}
          >
            <FileSpreadsheetIcon size={15} />
            <span>Download Excel (.xlsx)</span>
          </Button>
          <Button
            variant="secondary"
            onClick={() => download.run('csv')}
            disabled={!matrix || attendance.loading}
          >
            <DownloadIcon size={15} />
            <span>Download CSV</span>
          </Button>
          <Button
            variant="secondary"
            onClick={() => window.print()}
            disabled={!matrix || attendance.loading}
          >
            <PrinterIcon size={15} />
            <span>Print Attendance Sheet</span>
          </Button>
        </div>
      </div>

      <div className="print-sheet-header">
        <h2>Olabisi Onabanjo University — 15-Week Semester Attendance Register</h2>
        <p>
          <strong>Class:</strong> {klass.name}
          {klass.department_name ? ` · ${klass.department_name}` : ''}
          {klass.level ? ` (${klass.level})` : ''} ·{' '}
          <strong>Course:</strong> {course === ALL ? 'All Courses' : course} ·{' '}
          <strong>Recorded Weeks:</strong> {matrix ? matrix.heldWeeks.size : 0} of 15
        </p>
      </div>

      <div className="row no-print" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
        <p className="muted small">
          <strong>P</strong> = present, <strong>A</strong> = absent, <strong>Blank</strong> = past/upcoming week not marked yet.
          Click <strong>+ Mark</strong> under any unmarked week column to manually record attendance, or print/export with unmarked weeks left blank.
        </p>
        {matrix && (
          <Badge tone="ok">
            {matrix.heldWeeks.size} of 15 Weeks Recorded
          </Badge>
        )}
      </div>

      <ErrorAlert
        error={attendance.error ?? download.error}
        onRetry={attendance.error ? () => attendance.reload() : undefined}
      />

      {attendance.loading ? (
        <PageLoader label="Building 15-week attendance matrix" />
      ) : matrix ? (
        <div className="table-wrap sheet-wrap">
          <table className="table sheet">
            <thead>
              <tr>
                {matrix.header.map((h, i) => {
                  const isWeekCol = i >= 3 && i < 3 + matrix.weeks.length;
                  const weekNum = isWeekCol ? matrix.weeks[i - 3] : undefined;
                  const isHeld = weekNum !== undefined && matrix.heldWeeks.has(weekNum);
                  const weekSessions =
                    weekNum !== undefined ? sessions.filter((s) => s.week === weekNum) : [];

                  return (
                    <th
                      key={h}
                      className={[
                        i === 1 && 'sticky-col',
                        i > 2 && 'num',
                        isWeekCol && (isHeld ? 'week-th-held' : 'week-th-omitted'),
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      {isWeekCol && weekNum !== undefined ? (
                        <div className="week-th-inner">
                          <span className="row" style={{ gap: '0.25rem', justifyContent: 'flex-end' }}>
                            <span>W{weekNum}</span>
                            {isHeld && <CheckCircle2Icon size={11} className="no-print" />}
                          </span>
                          {isHeld && weekSessions.length === 1 ? (
                            <Link
                              to={`/rep/session/${weekSessions[0]!.id}?manual=1`}
                              className="week-th-link is-held no-print"
                              title={`Open & edit Week ${weekNum} attendance`}
                            >
                              Edit
                            </Link>
                          ) : !isHeld ? (
                            <Link
                              to={`/rep/class/${klass.id}/new-session?week=${weekNum}&mode=backfill${courseParam}`}
                              className="week-th-link is-omitted no-print"
                              title={`Manually mark omitted Week ${weekNum}`}
                            >
                              <PlusIcon size={10} />
                              <span>Mark</span>
                            </Link>
                          ) : null}
                        </div>
                      ) : (
                        h
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {matrix.rows.map((row) => (
                <tr key={String(row[2])}>
                  {row.map((cell, i) => (
                    <td
                      key={i}
                      className={[
                        i === 1 && 'sticky-col',
                        i === 2 && 'mono',
                        i > 2 && 'num',
                        cell === 'A' && 'cell-absent',
                        cell === 'P' && 'cell-present',
                        cell === '' && 'cell-blank',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
              {matrix.rows.length === 0 && (
                <tr>
                  <td colSpan={matrix.header.length} className="muted center">
                    No students on the class roster yet. Import or add students in the Student Roster tab.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
