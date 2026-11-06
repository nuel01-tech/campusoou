import { useCallback } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useAsync, useNow, usePolling } from '@/hooks/useAsync';
import { getMyEnrollment, listMyCheckIns, listOpenSessions } from '@/services/student';
import { isPasskeySupported } from '@/lib/webauthn';
import { CheckInCard } from '@/features/checkin/CheckInCard';
import { Badge, Button, EmptyState, ErrorAlert, PageHeader, PageLoader } from '@/components/ui';
import { KpiStatGrid, VerticalTabs, type VerticalTabItem } from '@/components/saas';
import { formatDate, formatTime, isOpen } from '@/lib/format';
import type { Attendance } from '@/types';

type StudentTabKey = 'live' | 'history' | 'device';

export function StudentHome() {
  const { ready, role } = useAuth();

  if (!ready) return <PageLoader />;
  if (role === 'super_admin') return <Navigate to="/admin" replace />;
  if (role === 'rep') return <Navigate to="/rep" replace />;
  if (role !== 'student') return <Navigate to="/" replace />;
  return <StudentDashboard />;
}

function StudentDashboard() {
  const me = useAsync(getMyEnrollment, []);
  const classId = me.data?.student.class_id;
  const [searchParams, setSearchParams] = useSearchParams();

  const rawTab = searchParams.get('tab') as StudentTabKey | null;
  const activeTab: StudentTabKey =
    rawTab && ['live', 'history', 'device'].includes(rawTab) ? rawTab : 'live';

  const setTab = (tab: StudentTabKey) => {
    setSearchParams({ tab });
  };

  const sessions = useAsync(
    () => (classId ? listOpenSessions(classId) : Promise.resolve([])),
    [classId],
  );
  const history = useAsync(() => (classId ? listMyCheckIns() : Promise.resolve([])), [classId]);
  const now = useNow(10_000);

  const refresh = useCallback(() => {
    void sessions.reload({ silent: true });
  }, [sessions]);
  usePolling(refresh, 15_000, Boolean(classId));

  if (me.loading) return <PageLoader />;
  if (me.error) {
    return (
      <div className="container narrow">
        <ErrorAlert error={me.error} onRetry={() => me.reload()} />
      </div>
    );
  }

  if (!me.data) {
    return (
      <div className="container narrow">
        <EmptyState
          title="This phone isn't linked to a student yet"
          action={
            <Link to="/" className="btn btn-primary btn-md">
              <span>Enter class code</span>
            </Link>
          }
        >
          Open the link your class rep shared, or enter the class code.
        </EmptyState>
      </div>
    );
  }

  const { student, className } = me.data;
  const open = (sessions.data ?? []).filter((s) => isOpen(s, now));
  const checkIns = (history.data ?? []).filter((c) => c.session);
  const bySession = new Map<string, Attendance>((history.data ?? []).map((a) => [a.session_id, a]));
  const passkeyRegistered = isPasskeySupported();

  const addCheckIn = (row: Attendance) => {
    history.setData((prev) => [{ ...row, session: null }, ...(prev ?? [])]);
    void history.reload({ silent: true });
  };

  const tabItems: VerticalTabItem<StudentTabKey>[] = [
    {
      key: 'live',
      label: 'Live Check-In',
      description: 'Open lecture sessions right now',
      badge: open.length,
    },
    {
      key: 'history',
      label: 'Attendance History',
      description: 'Your verified check-in log',
      badge: checkIns.length,
    },
    {
      key: 'device',
      label: 'My Passkey & Device',
      description: 'Bound phone & biometric status',
    },
  ];

  return (
    <div className="container stack-lg">
      <PageHeader
        title={student.full_name}
        subtitle={
          <span className="row" style={{ marginTop: '0.25rem', gap: '0.45rem' }}>
            <Badge tone="neutral">{className}</Badge>
            <span className="mono muted small">{student.matric_no}</span>
            {student.suspended ? (
              <Badge tone="muted">Suspended</Badge>
            ) : (
              <Badge tone="ok">Verified Device</Badge>
            )}
          </span>
        }
        actions={
          <Button variant="secondary" size="sm" onClick={refresh} disabled={sessions.loading}>
            Refresh sessions
          </Button>
        }
      />

      <KpiStatGrid
        items={[
          {
            label: 'Open Sessions Now',
            value: open.length,
            sublabel: open.length > 0 ? 'Ready for GPS + Passkey check-in' : 'Waiting for Class Rep',
            tone: open.length > 0 ? 'ok' : 'default',
          },
          {
            label: 'Lectures Attended',
            value: checkIns.length,
            sublabel: 'Total verified check-ins',
            tone: 'accent',
          },
          {
            label: 'Biometric Passkey',
            value: passkeyRegistered ? 'Active' : 'Setup on 1st Check-in',
            sublabel: 'Fingerprint / Face ID / PIN',
            tone: passkeyRegistered ? 'ok' : 'default',
          },
        ]}
      />

      <div className="vtabs-layout">
        <aside className="vtabs-rail">
          <VerticalTabs
            items={tabItems}
            activeKey={activeTab}
            onSelect={setTab}
            ariaLabel="Student portal navigation"
          />
        </aside>

        <div className="vtabs-panel">
          {activeTab === 'live' && (
            <section className="panel stack">
              <div className="section-head">
                <div>
                  <h2>Open Lecture Sessions</h2>
                  <p className="muted small">
                    Be inside the lecture venue and verify with your device passkey before the timer closes.
                  </p>
                </div>
                <button className="link-button" onClick={refresh} disabled={sessions.loading}>
                  Refresh
                </button>
              </div>

              <ErrorAlert error={sessions.error} onRetry={() => sessions.reload()} />

              {sessions.loading && !sessions.data ? (
                <PageLoader label="Checking for sessions" />
              ) : open.length === 0 ? (
                <EmptyState title="No session is open right now">
                  When your class rep starts a session, it will appear here automatically.
                </EmptyState>
              ) : (
                <div className="stack">
                  {open.map((s) => (
                    <CheckInCard
                      key={s.id}
                      session={s}
                      student={student}
                      now={now}
                      checkedIn={bySession.get(s.id)}
                      onCheckedIn={addCheckIn}
                    />
                  ))}
                </div>
              )}
            </section>
          )}

          {activeTab === 'history' && (
            <section className="panel stack">
              <div>
                <h2>Your Verified Check-Ins</h2>
                <p className="muted small">Complete log of lectures you have checked into from this device.</p>
              </div>

              <ErrorAlert error={history.error} onRetry={() => history.reload()} />

              {checkIns.length === 0 ? (
                <EmptyState title="No check-ins recorded yet">
                  Once you check in to an open lecture session, it will be listed here.
                </EmptyState>
              ) : (
                <ul className="history">
                  {checkIns.map((c) => (
                    <li key={c.id}>
                      <span className="history-course">{c.session!.course_code}</span>
                      <Badge tone="ok">Week {c.session!.week}</Badge>
                      <span className="history-when">
                        {formatDate(c.checked_in_at)}, {formatTime(c.checked_in_at)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {activeTab === 'device' && (
            <section className="panel stack">
              <h2>Bound Phone & Passkey Security</h2>
              <div className="stack-xs">
                <p>
                  <strong>Student Name:</strong> {student.full_name}
                </p>
                <p>
                  <strong>Matric Number:</strong> <span className="mono">{student.matric_no}</span>
                </p>
                <p>
                  <strong>Enrolled Cohort:</strong> {className}
                </p>
                <p>
                  <strong>Passkey Status:</strong>{' '}
                  {passkeyRegistered
                    ? 'Registered on this device (Fingerprint / Face ID / PIN)'
                    : 'Will be registered automatically on your next check-in'}
                </p>
              </div>
              <p className="muted small">
                Your matric number is cryptographically locked to this phone’s browser so no one else can claim your attendance. If you change or lose your phone, ask your Class Rep to click <strong>Reset phone</strong> next to your name on the class roster.
              </p>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
