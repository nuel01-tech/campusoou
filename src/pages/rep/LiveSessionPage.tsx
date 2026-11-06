import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAction, useAsync, useNow, usePolling } from '@/hooks/useAsync';
import { useToast } from '@/hooks/useToast';
import { getClass } from '@/services/classes';
import { listStudents } from '@/services/roster';
import {
  autoMarkClassRepsForSession,
  closeSession,
  deleteSession,
  extendSession,
  getSession,
  listAttendance,
  markPresent,
  removeAttendance,
} from '@/services/sessions';
import { Badge, Button, ConfirmButton, ErrorAlert, PageHeader, PageLoader, TextField } from '@/components/ui';
import { toAppError } from '@/lib/errors';
import { formatDate, formatTime, isOpen, timeLeft } from '@/lib/format';
import type { Attendance, Session, Student } from '@/types';

type Filter = 'all' | 'present' | 'absent';

export default function LiveSessionPage() {
  const { sessionId = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const now = useNow(5_000);

  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [busyStudent, setBusyStudent] = useState<string | null>(null);
  const [overrideActive, setOverrideActive] = useState(false);
  const [secretCount, setSecretCount] = useState(0);

  const triggerSecret = () => {
    const next = secretCount + 1;
    if (next >= 4) {
      setOverrideActive((prev) => {
        const val = !prev;
        toast(val ? 'Staff override enabled' : 'Staff override disabled', 'info');
        return val;
      });
      setSecretCount(0);
    } else {
      setSecretCount(next);
      setTimeout(() => setSecretCount(0), 2000);
    }
  };

  const base = useAsync(
    async () => {
      const session = await getSession(sessionId);
      const [klass, students] = await Promise.all([getClass(session.class_id), listStudents(session.class_id)]);
      return { session, klass, students };
    },
    [sessionId],
  );

  const attendance = useAsync(() => listAttendance(sessionId), [sessionId]);

  const live = base.data ? isOpen(base.data.session, now) : false;

  const refreshAttendance = useCallback(() => {
    void attendance.reload({ silent: true });
  }, [attendance]);

  usePolling(refreshAttendance, 5_000, live);

  const updateSession = (s: Session) => base.setData((prev) => (prev ? { ...prev, session: s } : prev));

  const close = useAction(async () => updateSession(await closeSession(sessionId)));
  const extend = useAction(async (mins: number) => {
    if (!base.data) return;
    updateSession(await extendSession(base.data.session, mins));
    toast(`Extended by ${mins} min`);
  });
  const remove = useAction(async () => {
    if (!base.data) return;
    const classId = base.data.session.class_id;
    await deleteSession(sessionId);
    toast('Session deleted');
    navigate(`/rep/class/${classId}`, { replace: true });
  });

  const byStudent = useMemo(
    () => new Map<string, Attendance>((attendance.data ?? []).map((a) => [a.student_id, a])),
    [attendance.data],
  );

  const students = base.data?.students ?? [];

  // Ensure all Class Reps in this class are automatically marked present for this session
  useEffect(() => {
    if (!base.data || attendance.loading || !attendance.data) return;
    const missingReps = base.data.students.filter(
      (s) => s.is_rep && !s.suspended && !byStudent.has(s.id),
    );
    if (missingReps.length === 0) return;

    void autoMarkClassRepsForSession(sessionId, base.data.session.class_id, missingReps).then((inserted) => {
      if (inserted.length > 0) {
        void attendance.reload({ silent: true });
      }
    });
  }, [base.data, attendance, byStudent, sessionId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return students.filter((s) => {
      const present = byStudent.has(s.id);
      if (filter === 'present' && !present) return false;
      if (filter === 'absent' && present) return false;
      if (!q) return true;
      return s.full_name.toLowerCase().includes(q) || s.matric_no.toLowerCase().includes(q);
    });
  }, [students, byStudent, filter, query]);

  const toggleStudent = async (st: Student) => {
    const existing = byStudent.get(st.id);
    setBusyStudent(st.id);
    try {
      if (existing) {
        await removeAttendance(existing.id);
        attendance.setData((prev) => (prev ?? []).filter((a) => a.id !== existing.id));
      } else {
        const added = await markPresent(sessionId, st.id);
        attendance.setData((prev) => [...(prev ?? []), added]);
      }
    } catch (e) {
      toast(toAppError(e).message, 'error');
    } finally {
      setBusyStudent(null);
    }
  };

  if (base.loading) return <PageLoader />;
  if (base.error || !base.data) {
    return (
      <div className="container">
        <ErrorAlert error={base.error} onRetry={() => base.reload()} />
      </div>
    );
  }

  const { session, klass } = base.data;
  const presentCount = byStudent.size;
  const totalCount = students.length;

  return (
    <div className="container">
      <PageHeader
        title={`${session.course_code} · Week ${session.week}`}
        subtitle={`${session.venue} · ${formatDate(session.starts_at)}, ${formatTime(session.starts_at)} · ${session.radius_m} m radius`}
        back={{ to: `/rep/class/${klass.id}`, label: klass.name }}
        actions={
          <div className="row">
            <Button variant="secondary" size="sm" onClick={() => extend.run(10)} loading={extend.pending}>
              {live ? '+10 min' : 'Reopen 10 min'}
            </Button>
            {live && (
              <Button variant="secondary" size="sm" onClick={() => close.run()} loading={close.pending}>
                End now
              </Button>
            )}
            <ConfirmButton size="sm" onConfirm={() => remove.run()} loading={remove.pending}>
              Delete
            </ConfirmButton>
          </div>
        }
      />

      <section className="session-summary">
        <div>
          <p className="summary-count" onClick={triggerSecret} style={{ cursor: 'pointer', userSelect: 'none' }} title="Session statistics">
            <strong>{presentCount}</strong> <span className="muted">of {totalCount} present</span>
          </p>
        </div>
        <div className="row">
          {live ? <Badge tone="live">Open · {timeLeft(session.ends_at, now)}</Badge> : <Badge tone="muted">Closed</Badge>}
        </div>
      </section>

      <ErrorAlert error={attendance.error ?? close.error ?? extend.error ?? remove.error} />

      <div className="toolbar">
        <div className="segmented" role="tablist" aria-label="Filter students">
          {(['all', 'present', 'absent'] as const).map((f) => (
            <button
              key={f}
              role="tab"
              aria-selected={filter === f}
              className={filter === f ? 'is-active' : ''}
              onClick={() => setFilter(f)}
            >
              {f === 'all'
                ? `All (${totalCount})`
                : f === 'present'
                  ? `Present (${presentCount})`
                  : `Absent (${Math.max(0, totalCount - presentCount)})`}
            </button>
          ))}
        </div>
        <TextField
          label="Search"
          className="search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Name or matric number"
        />
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Matric No</th>
              <th>Status</th>
              {overrideActive && (
                <th className="actions-col">
                  <span>Override</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {filtered.map((s) => {
              const row = byStudent.get(s.id);
              const busy = busyStudent === s.id;
              return (
                <tr key={s.id}>
                  <td>
                    <div className="row" style={{ gap: '0.5rem' }}>
                      <span>{s.full_name}</span>
                      {s.is_rep && <Badge tone="live">Class Rep</Badge>}
                    </div>
                  </td>
                  <td className="mono">{s.matric_no}</td>
                  <td>
                    {row ? (
                      <span className="status-present">
                        Present · {s.is_rep && !row.manual ? 'Auto (Class Rep)' : formatTime(row.checked_in_at)}
                      </span>
                    ) : (
                      <span className="muted">Absent</span>
                    )}
                  </td>
                  {overrideActive && (
                    <td className="actions-col">
                      <Button
                        variant={row ? 'ghost' : 'secondary'}
                        size="sm"
                        loading={busy}
                        onClick={() => toggleStudent(s)}
                      >
                        {row ? 'Undo' : 'Mark present'}
                      </Button>
                    </td>
                  )}
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={overrideActive ? 4 : 3} className="muted center">
                  No students match this view.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
