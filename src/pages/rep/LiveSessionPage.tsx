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
  markBatchAttendance,
  markPresent,
  removeAttendance,
} from '@/services/sessions';
import { Badge, Button, ConfirmButton, ErrorAlert, PageHeader, PageLoader, TextField } from '@/components/ui';
import { toAppError } from '@/lib/errors';
import { formatDate, formatTime, isOpen, timeLeft } from '@/lib/format';
import type { Attendance, Session, Student } from '@/types';

type Filter = 'all' | 'present' | 'absent' | 'late' | 'excused';

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

  // New Modals for Attendance Management Features
  const [showQrModal, setShowQrModal] = useState(false);
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [selectedBatchIds, setSelectedBatchIds] = useState<string[]>([]);
  const [batchActionPending, setBatchActionPending] = useState(false);
  const [excuseStudent, setExcuseStudent] = useState<Student | null>(null);
  const [excuseNote, setExcuseNote] = useState('');

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
      const row = byStudent.get(s.id);
      const isPresent = Boolean(row);
      const isLate = row?.status === 'late';
      const isExcused = row?.status === 'excused';

      if (filter === 'present' && !isPresent) return false;
      if (filter === 'absent' && isPresent) return false;
      if (filter === 'late' && !isLate) return false;
      if (filter === 'excused' && !isExcused) return false;
      if (!q) return true;
      return s.full_name.toLowerCase().includes(q) || s.matric_no.toLowerCase().includes(q);
    });
  }, [students, byStudent, filter, query]);

  const toggleStudent = async (st: Student, status: 'present' | 'late' | 'excused' = 'present', note?: string) => {
    const existing = byStudent.get(st.id);
    setBusyStudent(st.id);
    try {
      if (existing && status === 'present' && existing.status === 'present') {
        await removeAttendance(existing.id);
        attendance.setData((prev) => (prev ?? []).filter((a) => a.id !== existing.id));
      } else {
        const added = await markPresent(sessionId, st.id, status, note);
        attendance.setData((prev) => {
          const others = (prev ?? []).filter((a) => a.student_id !== st.id);
          return [...others, added];
        });
      }
    } catch (e) {
      toast(toAppError(e).message, 'error');
    } finally {
      setBusyStudent(null);
    }
  };

  const handleBatchMark = async () => {
    if (selectedBatchIds.length === 0) return;
    setBatchActionPending(true);
    try {
      const count = await markBatchAttendance(sessionId, selectedBatchIds, 'present');
      toast(`Marked ${count} students present`);
      setShowBatchModal(false);
      setSelectedBatchIds([]);
      void attendance.reload({ silent: true });
    } catch (e) {
      toast(toAppError(e).message, 'error');
    } finally {
      setBatchActionPending(false);
    }
  };

  const handleShareWhatsAppReport = () => {
    if (!base.data) return;
    const { session, klass } = base.data;
    const presentCount = byStudent.size;
    const totalCount = students.length;
    const pct = totalCount > 0 ? Math.round((presentCount / totalCount) * 100) : 0;
    const text = [
      `*CampusPulse — Roll-Call Attendance Report*`,
      `*Course:* ${session.course_code} (Week ${session.week})`,
      `*Class:* ${klass.name} ${klass.level ? `(${klass.level})` : ''}`,
      `*Venue:* ${session.venue}`,
      `*Date & Time:* ${formatDate(session.starts_at)}, ${formatTime(session.starts_at)}`,
      `*Total Enrolled:* ${totalCount} students`,
      `*Present:* ${presentCount} (${pct}%)`,
      `*Absent:* ${Math.max(0, totalCount - presentCount)} students`,
      `*Status:* ${live ? 'Session in progress' : 'Session closed'}`,
      `\n_Generated securely via CampusPulse Attendance System_`,
    ].join('\n');
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
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
  const joinUrl = `${window.location.origin}/join/${klass.join_code}`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(joinUrl)}`;

  return (
    <div className="container">
      <PageHeader
        title={`${session.course_code} · Week ${session.week}`}
        subtitle={`${session.venue} · ${formatDate(session.starts_at)}, ${formatTime(session.starts_at)} · ${session.radius_m} m radius`}
        back={{ to: `/rep/class/${klass.id}`, label: klass.name }}
        actions={
          <div className="row">
            <Button variant="secondary" size="sm" onClick={() => setShowQrModal(true)}>
              📺 Broadcast QR
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setShowBatchModal(true)}>
              ⚡ Batch Roll-Call
            </Button>
            <Button variant="secondary" size="sm" onClick={handleShareWhatsAppReport}>
              💬 WhatsApp Report
            </Button>
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
          <Button size="sm" variant="ghost" onClick={() => setOverrideActive((v) => !v)}>
            {overrideActive ? 'Hide staff overrides' : 'Manual override'}
          </Button>
          {live ? <Badge tone="live">Open · {timeLeft(session.ends_at, now)}</Badge> : <Badge tone="muted">Closed</Badge>}
        </div>
      </section>

      <ErrorAlert error={attendance.error ?? close.error ?? extend.error ?? remove.error} />

      <div className="toolbar">
        <div className="segmented" role="tablist" aria-label="Filter students">
          {(['all', 'present', 'absent', 'late', 'excused'] as const).map((f) => (
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
                  : f === 'absent'
                    ? `Absent (${Math.max(0, totalCount - presentCount)})`
                    : f.charAt(0).toUpperCase() + f.slice(1)}
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
                  <span>Actions & Excuses</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {filtered.map((s) => {
              const row = byStudent.get(s.id);
              const busy = busyStudent === s.id;
              const isLate =
                row?.status === 'late' ||
                (row && new Date(row.checked_in_at).getTime() - new Date(session.starts_at).getTime() > 15 * 60_000);
              const isExcused = row?.status === 'excused';

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
                      isExcused ? (
                        <span className="status-present" style={{ color: 'var(--warn)' }}>
                          Excused {row.notes ? `(${row.notes})` : ''}
                        </span>
                      ) : isLate ? (
                        <span className="status-present" style={{ color: 'var(--warn)' }}>
                          Late · {formatTime(row.checked_in_at)}
                        </span>
                      ) : (
                        <span className="status-present">
                          Present · {s.is_rep && !row.manual ? 'Auto (Class Rep)' : formatTime(row.checked_in_at)}
                        </span>
                      )
                    ) : (
                      <span className="muted">Absent</span>
                    )}
                  </td>
                  {overrideActive && (
                    <td className="actions-col">
                      <div className="row" style={{ justifyContent: 'flex-end', gap: '0.35rem' }}>
                        <Button
                          variant={row ? 'ghost' : 'secondary'}
                          size="sm"
                          loading={busy}
                          onClick={() => toggleStudent(s, 'present')}
                        >
                          {row ? 'Undo' : 'Present'}
                        </Button>
                        {!row && (
                          <Button
                            variant="ghost"
                            size="sm"
                            loading={busy}
                            onClick={() => toggleStudent(s, 'late')}
                          >
                            Late
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          loading={busy}
                          onClick={() => {
                            setExcuseStudent(s);
                            setExcuseNote('');
                          }}
                        >
                          Excuse
                        </Button>
                      </div>
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

      {/* 1. Full-Screen Broadcast QR & Projector Mode Modal */}
      {showQrModal && (
        <div className="cmd-backdrop" onClick={() => setShowQrModal(false)} role="dialog" aria-modal="true">
          <div className="cmd-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '480px', textAlign: 'center', padding: '1.75rem' }}>
            <h2>{session.course_code} · Live Check-In</h2>
            <p className="muted small" style={{ marginTop: '0.25rem' }}>
              Venue: {session.venue} · {session.radius_m}m GPS Radius
            </p>
            <div style={{ margin: '1.25rem auto', padding: '1rem', background: '#fff', borderRadius: '12px', width: 'fit-content', border: '1px solid var(--border)' }}>
              <img src={qrUrl} alt="Session QR Code" width="260" height="260" style={{ display: 'block', borderRadius: '8px' }} />
            </div>
            <div className="stack" style={{ gap: '0.5rem' }}>
              <p className="mono" style={{ fontSize: '1.5rem', fontWeight: 800, letterSpacing: '0.12em' }}>
                CODE: {klass.join_code}
              </p>
              <p className="small muted">
                Students can scan this QR code or visit <strong className="mono">{window.location.origin}/join</strong> and enter the 6-character code.
              </p>
            </div>
            <div style={{ marginTop: '1.25rem' }}>
              <Button onClick={() => setShowQrModal(false)} className="btn-block">
                Close Projector View
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 2. Emergency Rapid Batch Roll-Call Modal */}
      {showBatchModal && (
        <div className="cmd-backdrop" onClick={() => setShowBatchModal(false)} role="dialog" aria-modal="true">
          <div className="cmd-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '580px', padding: '1.5rem' }}>
            <div className="section-head">
              <div>
                <h2>Emergency Rapid Batch Roll-Call</h2>
                <p className="muted small">Quickly mark multiple absent students present in bulk.</p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setShowBatchModal(false)}>
                ✕
              </Button>
            </div>
            <div className="row" style={{ margin: '0.75rem 0', gap: '0.5rem' }}>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setSelectedBatchIds(students.filter((s) => !byStudent.has(s.id)).map((s) => s.id))}
              >
                Select all absent ({Math.max(0, totalCount - presentCount)})
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelectedBatchIds([])}>
                Clear selection
              </Button>
            </div>
            <div style={{ maxHeight: '280px', overflowY: 'auto', border: '1px solid var(--border)', borderRadius: '6px', padding: '0.5rem' }}>
              {students.map((s) => {
                const already = byStudent.has(s.id);
                const checked = selectedBatchIds.includes(s.id);
                return (
                  <label key={s.id} className="row" style={{ padding: '0.35rem 0.5rem', cursor: 'pointer', borderBottom: '1px solid var(--border-subtle, #eee)' }}>
                    <input
                      type="checkbox"
                      checked={already || checked}
                      disabled={already}
                      onChange={(e) => {
                        if (e.target.checked) setSelectedBatchIds((prev) => [...prev, s.id]);
                        else setSelectedBatchIds((prev) => prev.filter((id) => id !== s.id));
                      }}
                    />
                    <span style={{ flex: 1, fontSize: '0.9rem' }}>
                      {s.full_name} <span className="mono muted small">({s.matric_no})</span>
                    </span>
                    {already && <Badge tone="ok">Already Present</Badge>}
                  </label>
                );
              })}
            </div>
            <div className="row" style={{ marginTop: '1rem', justifyContent: 'flex-end' }}>
              <Button variant="ghost" onClick={() => setShowBatchModal(false)}>
                Cancel
              </Button>
              <Button loading={batchActionPending} onClick={handleBatchMark} disabled={selectedBatchIds.length === 0}>
                Mark {selectedBatchIds.length} Students Present
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 3. Excused Absence Reason Modal */}
      {excuseStudent && (
        <div className="cmd-backdrop" onClick={() => setExcuseStudent(null)} role="dialog" aria-modal="true">
          <div className="cmd-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '420px', padding: '1.5rem' }}>
            <h3>Log Excused Absence</h3>
            <p className="muted small" style={{ margin: '0.35rem 0 1rem' }}>
              Student: <strong>{excuseStudent.full_name}</strong> ({excuseStudent.matric_no})
            </p>
            <TextField
              label="Reason for Excuse"
              placeholder="e.g. Medical clinic note, Sports representation…"
              value={excuseNote}
              onChange={(e) => setExcuseNote(e.target.value)}
              autoFocus
            />
            <div className="row" style={{ marginTop: '1.25rem', justifyContent: 'flex-end' }}>
              <Button variant="ghost" onClick={() => setExcuseStudent(null)}>
                Cancel
              </Button>
              <Button
                onClick={async () => {
                  await toggleStudent(excuseStudent, 'excused', excuseNote);
                  setExcuseStudent(null);
                }}
              >
                Save Excuse
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
