import { useMemo, useState } from 'react';
import { useAction, useAsync } from '@/hooks/useAsync';
import { listStudents } from '@/services/roster';
import { listAttendanceFor, listSessions } from '@/services/sessions';
import { Button, EmptyState, ErrorAlert, PageLoader, SelectField } from '@/components/ui';
import { DownloadIcon, FileSpreadsheetIcon } from '@/components/icons';
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
    () => (base.data && attendance.data ? buildMatrix(base.data.students, sessions, attendance.data) : null),
    [base.data, sessions, attendance.data],
  );

  const download = useAction(async (format: ExportFormat) => {
    if (!matrix) return;
    const label = course === ALL ? 'All courses' : course;
    await downloadMatrix(matrix, `${klass.name} ${label} attendance`, format);
  });

  if (base.loading) return <PageLoader />;
  if (base.error) return <ErrorAlert error={base.error} onRetry={() => base.reload()} />;
  if (!base.data?.sessions.length) {
    return (
      <EmptyState title="Nothing to export yet">
        Run at least one session and the vertical weekly attendance matrix will appear here.
      </EmptyState>
    );
  }

  return (
    <div className="panel stack">
      <div className="export-bar">
        <SelectField label="Course filter" value={course} onChange={(e) => setPicked(e.target.value)}>
          {courses.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
          {courses.length > 1 && <option value={ALL}>All courses combined</option>}
        </SelectField>
        <div className="row">
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
        </div>
      </div>
      <p className="muted small">
        <strong>P</strong> = present, <strong>A</strong> = absent. Weeks with more than one session show attended/held,
        e.g. <code>1/2</code>.
      </p>

      <ErrorAlert
        error={attendance.error ?? download.error}
        onRetry={attendance.error ? () => attendance.reload() : undefined}
      />

      {attendance.loading ? (
        <PageLoader label="Building sheet" />
      ) : matrix ? (
        <div className="table-wrap sheet-wrap">
          <table className="table sheet">
            <thead>
              <tr>
                {matrix.header.map((h, i) => (
                  <th key={h} className={i === 1 ? 'sticky-col' : i > 2 ? 'num' : undefined}>
                    {h}
                  </th>
                ))}
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
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
