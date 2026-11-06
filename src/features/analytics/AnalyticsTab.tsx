import { useMemo, useState } from 'react';
import { useAsync } from '@/hooks/useAsync';
import { listStudents } from '@/services/roster';
import { listAttendanceFor, listSessions } from '@/services/sessions';
import {
  Badge,
  Button,
  EmptyState,
  ErrorAlert,
  PageLoader,
  SelectField,
  StatusPill,
  StudentCell,
  TextField,
} from '@/components/ui';
import { KpiStatGrid, ProgressBar } from '@/components/saas';
import { AwardIcon, MessageSquareIcon } from '@/components/icons';
import type { Attendance, ClassRoom, Session, Student } from '@/types';

const ALL = '__all__';
const ELIGIBILITY_THRESHOLD = 75;

export interface StudentEligibilityRow {
  student: Student;
  attended: number;
  totalSessions: number;
  rate: number;
  eligible: boolean;
}

export function computeEligibilityReport(
  students: Student[],
  sessions: Session[],
  attendance: Attendance[],
): StudentEligibilityRow[] {
  const totalSessions = sessions.length;
  const sessionIds = new Set(sessions.map((s) => s.id));
  const countsByStudent = new Map<string, number>();

  for (const a of attendance) {
    if (sessionIds.has(a.session_id)) {
      countsByStudent.set(a.student_id, (countsByStudent.get(a.student_id) ?? 0) + 1);
    }
  }

  return students
    .map((student) => {
      const attended = countsByStudent.get(student.id) ?? 0;
      const rate = totalSessions > 0 ? Math.round((attended / totalSessions) * 100) : 0;
      return {
        student,
        attended,
        totalSessions,
        rate,
        eligible: rate >= ELIGIBILITY_THRESHOLD,
      };
    })
    .sort((a, b) => b.rate - a.rate || a.student.full_name.localeCompare(b.student.full_name));
}

export function AnalyticsTab({ klass }: { klass: ClassRoom }) {
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

  const [course, setCourse] = useState<string>(ALL);
  const [filter, setFilter] = useState<'all' | 'eligible' | 'defaulters'>('all');
  const [search, setSearch] = useState('');

  const filteredSessions = useMemo(
    () => (base.data?.sessions ?? []).filter((s) => course === ALL || s.course_code === course),
    [base.data, course],
  );
  const sessionKey = filteredSessions.map((s) => s.id).join(',');

  const attendance = useAsync(
    () => (filteredSessions.length ? listAttendanceFor(filteredSessions.map((s) => s.id)) : Promise.resolve([])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessionKey],
  );

  const report = useMemo(
    () =>
      base.data && attendance.data
        ? computeEligibilityReport(base.data.students, filteredSessions, attendance.data)
        : [],
    [base.data, filteredSessions, attendance.data],
  );

  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return report.filter((r) => {
      if (filter === 'eligible' && !r.eligible) return false;
      if (filter === 'defaulters' && r.eligible) return false;
      if (!q) return true;
      return (
        r.student.full_name.toLowerCase().includes(q) ||
        r.student.matric_no.toLowerCase().includes(q)
      );
    });
  }, [report, filter, search]);

  const sendWhatsAppWarning = (row: StudentEligibilityRow) => {
    const text = [
      `*ATTENDANCE EXAM ELIGIBILITY NOTICE — 75% RULE*`,
      `Student: ${row.student.full_name} (${row.student.matric_no})`,
      `Class: ${klass.name} ${klass.level ? `(${klass.level})` : ''}`,
      `Current Attendance Rate: ${row.rate}% (${row.attended}/${row.totalSessions} sessions)`,
      `Status: ${row.eligible ? 'ELIGIBLE' : 'DEBARRED / BELOW 75% THRESHOLD'}`,
      `\n*Action Required:* You have failed to meet the required 75% lecture attendance threshold. Contact your Class Representative immediately to review your attendance record before the examination list is signed.`,
    ].join('\n');
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
  };

  const shareSummaryWithLecturer = () => {
    const eligibleCount = report.filter((r) => r.eligible).length;
    const defaulterCount = report.length - eligibleCount;
    const avg = report.length > 0 ? Math.round(report.reduce((s, r) => s + r.rate, 0) / report.length) : 0;
    const text = [
      `*CampusPulse — Official 75% Exam Eligibility Summary*`,
      `*Cohort:* ${klass.name} ${klass.level ? `(${klass.level})` : ''}`,
      `*Course:* ${course === ALL ? 'All Courses Combined' : course}`,
      `*Total Lectures Held:* ${filteredSessions.length}`,
      `*Total Roster Students:* ${report.length}`,
      `*Class Average Attendance:* ${avg}%`,
      `*Exam Qualified (≥75%):* ${eligibleCount} students`,
      `*Disqualified Defaulters (<75%):* ${defaulterCount} students`,
      `\n_Generated for Course Lecturer & Departmental Examination Committee_`,
    ].join('\n');
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
  };

  if (base.loading) return <PageLoader />;
  if (base.error) return <ErrorAlert error={base.error} onRetry={() => base.reload()} />;

  if (!base.data?.sessions.length) {
    return (
      <EmptyState title="No attendance analytics yet">
        Once you run at least one lecture session, student attendance rates and 75% exam eligibility metrics will appear here.
      </EmptyState>
    );
  }

  const eligibleCount = report.filter((r) => r.eligible).length;
  const defaulterCount = report.length - eligibleCount;
  const avgRate =
    report.length > 0 ? Math.round(report.reduce((sum, r) => sum + r.rate, 0) / report.length) : 0;

  return (
    <div className="stack-lg">
      <div className="section-head">
        <div>
          <h2>Attendance Analytics & 75% Exam Eligibility</h2>
          <p className="muted small">
            Tracks individual student attendance percentages against the 75% NUC exam eligibility threshold.
          </p>
        </div>
        <Button size="sm" variant="secondary" onClick={shareSummaryWithLecturer}>
          <MessageSquareIcon size={14} />
          <span>WhatsApp Summary to Lecturer / HOD</span>
        </Button>
      </div>

      <KpiStatGrid
        items={[
          {
            label: 'Lectures Analyzed',
            value: filteredSessions.length,
            sublabel: course === ALL ? `${courses.length} course(s) combined` : course,
            tone: 'accent',
          },
          {
            label: 'Class Average Rate',
            value: `${avgRate}%`,
            sublabel: `Across ${report.length} students`,
            tone: avgRate >= 75 ? 'ok' : 'warn',
          },
          {
            label: 'Exam Eligible (≥ 75%)',
            value: eligibleCount,
            sublabel: `${report.length ? Math.round((eligibleCount / report.length) * 100) : 0}% of class roster`,
            tone: 'ok',
          },
          {
            label: 'Below 75% (At Risk)',
            value: defaulterCount,
            sublabel: 'Needs attendance improvement',
            tone: defaulterCount > 0 ? 'danger' : 'default',
          },
        ]}
      />

      <div className="panel stack">
        <div className="filter-bar">
          <SelectField label="Course filter" value={course} onChange={(e) => setCourse(e.target.value)}>
            <option value={ALL}>All courses combined ({base.data.sessions.length} sessions)</option>
            {courses.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </SelectField>

          <SelectField
            label="Eligibility status"
            value={filter}
            onChange={(e) => setFilter(e.target.value as 'all' | 'eligible' | 'defaulters')}
          >
            <option value="all">All students ({report.length})</option>
            <option value="eligible">Eligible ≥ 75% ({eligibleCount})</option>
            <option value="defaulters">Below 75% At Risk ({defaulterCount})</option>
          </SelectField>

          <TextField
            label="Search student"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name or matric no…"
          />
        </div>

        <ErrorAlert error={attendance.error} onRetry={() => attendance.reload()} />

        {attendance.loading ? (
          <PageLoader label="Calculating eligibility" />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Student Name</th>
                  <th>Matric No</th>
                  <th className="num">Attended</th>
                  <th style={{ minWidth: '150px' }}>Attendance Rate</th>
                  <th>75% Exam Status</th>
                  <th className="actions-col">Notice</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => (
                  <tr key={row.student.id}>
                    <td>
                      <StudentCell
                        name={row.student.full_name}
                        badges={
                          row.rate === 100 ? (
                            <Badge tone="ok" icon={<AwardIcon size={11} />}>
                              100% Streak
                            </Badge>
                          ) : undefined
                        }
                      />
                    </td>
                    <td className="mono">{row.student.matric_no}</td>
                    <td className="num mono">
                      {row.attended} / {row.totalSessions}
                    </td>
                    <td>
                      <ProgressBar
                        value={row.rate}
                        max={100}
                        label={`${row.rate}%`}
                        tone={row.eligible ? 'ok' : 'warn'}
                      />
                    </td>
                    <td>
                      <StatusPill
                        status={row.eligible ? 'present' : 'absent'}
                        label={row.eligible ? `Eligible (${row.rate}%)` : `Below 75% (${row.rate}%)`}
                      />
                    </td>
                    <td className="actions-col">
                      {!row.eligible && (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => sendWhatsAppWarning(row)}
                        >
                          <MessageSquareIcon size={13} />
                          <span>WhatsApp Warning</span>
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
                {visibleRows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="muted center">
                      No students match the selected filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
