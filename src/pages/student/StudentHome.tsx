import { useCallback } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useAction, useAsync, useNow, usePolling } from '@/hooks/useAsync';
import { useToast } from '@/hooks/useToast';
import { StudentProfileTab } from '@/pages/student/StudentProfileTab';
import { hasPermanentStudentLogin } from '@/services/auth';
import {
  bindStudentPasskey,
  getMyEnrollment,
  listMyCheckIns,
  listOpenSessions,
} from '@/services/student';
import {
  detectIncognitoMode,
  getExistingDeviceToken,
  isInAppBrowser,
  openInExternalBrowser,
  registerDevicePasskey,
  restoreDeviceWithPasskey,
} from '@/lib/webauthn';
import { CheckInCard } from '@/features/checkin/CheckInCard';
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  ErrorAlert,
  PageHeader,
  PageLoader,
  StatusPill,
} from '@/components/ui';
import { KpiStatGrid, VerticalTabs, type VerticalTabItem } from '@/components/saas';
import {
  ArrowUpRightIcon,
  CalendarDaysIcon,
  ClipboardCheckIcon,
  GraduationCapIcon,
  KeyRoundIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
  SmartphoneIcon,
} from '@/components/icons';
import { formatDate, formatTime, isOpen } from '@/lib/format';
import type { Attendance } from '@/types';

type StudentTabKey = 'live' | 'history' | 'device' | 'profile';

export function StudentHome() {
  const { ready, role } = useAuth();

  if (!ready) return <PageLoader />;
  if (role === 'super_admin') return <Navigate to="/admin" replace />;
  if (role === 'rep') return <Navigate to="/rep" replace />;
  if (role !== 'student') return <Navigate to="/" replace />;
  return <StudentDashboard />;
}

function StudentDashboard() {
  const { user, refreshAuth } = useAuth();
  const me = useAsync(getMyEnrollment, []);
  const incognito = useAsync(detectIncognitoMode, []);
  const localToken = useAsync(getExistingDeviceToken, []);
  const toast = useToast();
  const classId = me.data?.student.class_id;
  const [searchParams, setSearchParams] = useSearchParams();

  const rawTab = searchParams.get('tab') as StudentTabKey | null;
  const activeTab: StudentTabKey =
    rawTab && ['live', 'history', 'device', 'profile'].includes(rawTab) ? rawTab : 'live';

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
    void history.reload({ silent: true });
  }, [sessions, history]);
  usePolling(refresh, 15_000, Boolean(classId));

  // For students who claimed before the mandatory passkey-on-claim upgrade:
  const bindPasskeyAction = useAction(async () => {
    if (!me.data) return null;
    const { student } = me.data;
    const { passkeyId, deviceToken } = await registerDevicePasskey(
      student.full_name,
      student.matric_no,
    );
    const updated = await bindStudentPasskey(passkeyId, deviceToken);
    me.setData({ student: updated, className: me.data.className });
    void localToken.reload({ silent: true });
    toast('Hardware passkey bound to this phone!');
    return updated;
  });

  // For students who signed back in with email/password on their registered phone after clearing browser storage:
  const restorePasskeyAction = useAction(async () => {
    if (!me.data?.student.passkey_id || !me.data?.student.device_token) return null;
    const token = await restoreDeviceWithPasskey(
      me.data.student.passkey_id,
      me.data.student.device_token,
    );
    await localToken.reload({ silent: true });
    toast('Phone passkey verified and device vault restored!');
    return token;
  });

  if (me.loading || incognito.loading || localToken.loading) return <PageLoader />;

  if (incognito.data) {
    return (
      <div className="container narrow stack">
        <Alert tone="error" title="Incognito / Private Mode is Blocked">
          CampusPulse requires your normal browser window so your phone’s hardware passkey and device token stay strictly linked. Please close Incognito and open this page in normal browsing mode.
        </Alert>
      </div>
    );
  }

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
          Open the link your class rep shared, or enter the class code to set up your passkey and claim your account.
        </EmptyState>
      </div>
    );
  }

  const { student, className } = me.data;
  const open = (sessions.data ?? []).filter((s) => isOpen(s, now));
  const checkIns = (history.data ?? []).filter((c) => c.session);
  const bySession = new Map<string, Attendance>((history.data ?? []).map((a) => [a.session_id, a]));

  const needsInitialPasskeyBind = !student.passkey_id || !student.device_token;
  const deviceMismatch =
    !needsInitialPasskeyBind &&
    (!localToken.data || localToken.data !== student.device_token);
  const hasPermanentLogin = hasPermanentStudentLogin(user);

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
      icon: <ClipboardCheckIcon size={16} />,
    },
    {
      key: 'history',
      label: 'Attendance History',
      description: 'Your verified check-in log',
      badge: checkIns.length,
      icon: <CalendarDaysIcon size={16} />,
    },
    {
      key: 'device',
      label: 'My Passkey & Device',
      description: 'Bound phone & biometric status',
      icon: <KeyRoundIcon size={16} />,
    },
    {
      key: 'profile',
      label: 'My Profile',
      description: 'Personal details & account access',
      badge: !hasPermanentLogin ? 'Setup' : undefined,
      icon: <GraduationCapIcon size={16} />,
    },
  ];

  return (
    <div className="container stack-lg">
      <PageHeader
        eyebrow="Student Attendance Workspace"
        title={student.full_name}
        subtitle={
          <span className="row" style={{ marginTop: '0.25rem', gap: '0.45rem' }}>
            <Badge tone="neutral">{className}</Badge>
            <span className="mono muted small">{student.matric_no}</span>
            {student.is_rep && <Badge tone="live">Class Rep · Auto-Present</Badge>}
            {student.suspended ? (
              <Badge tone="danger">Suspended</Badge>
            ) : needsInitialPasskeyBind ? (
              <Badge tone="warn">Passkey Pending</Badge>
            ) : deviceMismatch ? (
              <Badge tone="danger">Verify Phone Passkey</Badge>
            ) : (
              <Badge tone="ok" icon={<ShieldCheckIcon size={12} />}>
                Passkey & Phone Locked
              </Badge>
            )}
          </span>
        }
        actions={
          <Button variant="secondary" size="sm" onClick={refresh} disabled={sessions.loading}>
            <RefreshCwIcon size={14} />
            <span>Refresh</span>
          </Button>
        }
      />

      {isInAppBrowser() && (
        <Alert
          tone="info"
          title="Opened inside WhatsApp / In-App Browser"
          action={
            <Button size="sm" variant="secondary" onClick={() => openInExternalBrowser()}>
              <span>Open in Chrome / Browser</span>
              <ArrowUpRightIcon size={13} />
            </Button>
          }
        >
          Check-in works right here in WhatsApp, or tap <strong>Open in Chrome / Browser</strong> to launch your main mobile browser.
        </Alert>
      )}

      {!hasPermanentLogin && activeTab !== 'profile' && (
        <Alert
          tone="info"
          title="Save an Email & Password for Permanent Access"
          action={
            <Button size="sm" variant="secondary" onClick={() => setTab('profile')}>
              Set Up Login
            </Button>
          }
        >
          Protect your claimed student account before signing out so you can sign back in anytime at{' '}
          <strong className="mono">/student/login</strong>.
        </Alert>
      )}

      {needsInitialPasskeyBind && (
        <div className="panel stack">
          <Alert
            tone="warning"
            title="Action Required: Complete Your Passkey Setup"
            action={
              <Button
                size="sm"
                onClick={() => void bindPasskeyAction.run()}
                loading={bindPasskeyAction.pending}
              >
                Set Up Passkey Now
              </Button>
            }
          >
            To check in to lectures, you must bind your phone’s Fingerprint, Face ID, or screen lock Passkey to your matric number (<strong className="mono">{student.matric_no}</strong>).
          </Alert>
          <ErrorAlert error={bindPasskeyAction.error} />
        </div>
      )}

      {deviceMismatch && (
        <div className="panel stack">
          <Alert
            tone="warning"
            title="Verify Your Registered Phone Passkey"
            action={
              <Button
                size="sm"
                onClick={() => void restorePasskeyAction.run()}
                loading={restorePasskeyAction.pending}
              >
                <KeyRoundIcon size={14} />
                <span>Verify My Passkey on This Phone</span>
              </Button>
            }
          >
            This browser session does not have the local device token for{' '}
            <strong className="mono">{student.matric_no}</strong> (for example, if you signed in after clearing browser data). If this is your registered phone, tap{' '}
            <strong>Verify My Passkey on This Phone</strong> to unlock it with your Fingerprint / Face ID, or ask your Class Rep to click{' '}
            <strong>Reset phone</strong> on the roster if you changed phones.
          </Alert>
          <ErrorAlert error={restorePasskeyAction.error} />
        </div>
      )}

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
            sublabel: 'Total verified lecture check-ins',
            tone: 'accent',
          },
          {
            label: 'Hardware Passkey',
            value: needsInitialPasskeyBind
              ? 'Setup Required'
              : deviceMismatch
                ? 'Verify Phone'
                : 'Strictly Bound',
            sublabel: '1 Phone = 1 Student (No Incognito)',
            tone: !needsInitialPasskeyBind && !deviceMismatch ? 'ok' : 'warn',
          },
          {
            label: 'Matric Number',
            value: student.matric_no,
            sublabel: className,
            tone: 'purple',
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
                  <h2>Live Lecture Check-In</h2>
                  <p className="muted small">
                    Be inside the lecture venue and verify with your bound phone Passkey before the timer closes.
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={refresh} disabled={sessions.loading}>
                  <RefreshCwIcon size={13} />
                  <span>Refresh</span>
                </Button>
              </div>

              <ErrorAlert error={sessions.error} onRetry={() => sessions.reload()} />

              {needsInitialPasskeyBind ? (
                <EmptyState
                  title="Set up your Passkey first"
                  action={
                    <Button
                      onClick={() => void bindPasskeyAction.run()}
                      loading={bindPasskeyAction.pending}
                    >
                      Set Up Passkey & Lock Phone
                    </Button>
                  }
                >
                  Tap above to register your Fingerprint, Face ID, or screen lock before checking in to live sessions.
                </EmptyState>
              ) : sessions.loading && !sessions.data ? (
                <PageLoader label="Checking for sessions" />
              ) : open.length === 0 ? (
                <EmptyState title="No session is open right now">
                  When your Class Representative starts a lecture session, it will appear here automatically.
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
              <div className="section-head">
                <div>
                  <h2>Attendance History</h2>
                  <p className="muted small">
                    Complete log of lectures you have checked into from this device.
                  </p>
                </div>
                <Badge tone="ok">{checkIns.length} Verified</Badge>
              </div>

              <ErrorAlert error={history.error} onRetry={() => history.reload()} />

              {checkIns.length === 0 ? (
                <EmptyState title="No check-ins recorded yet">
                  Once you check in to an open lecture session, it will be listed here with course, week, and timestamp.
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
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {checkIns.map((c) => {
                        const st =
                          c.status === 'late'
                            ? 'late'
                            : c.status === 'excused'
                              ? 'excused'
                              : 'present';
                        return (
                          <tr key={c.id}>
                            <td>
                              <strong>{c.session!.course_code}</strong>
                            </td>
                            <td className="muted">{c.session!.venue || 'Lecture Hall'}</td>
                            <td className="num mono">Week {c.session!.week}</td>
                            <td className="nowrap muted">
                              {formatDate(c.checked_in_at)}, {formatTime(c.checked_in_at)}
                            </td>
                            <td>
                              <StatusPill status={st} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {activeTab === 'profile' && (
            <StudentProfileTab
              student={student}
              className={className}
              user={user}
              onSaved={(updated) => me.setData({ student: updated, className })}
              onAuthUpdated={refreshAuth}
            />
          )}

          {activeTab === 'device' && (
            <section className="panel stack">
              <div className="section-head">
                <div>
                  <h2>Bound Phone & Passkey Security</h2>
                  <p className="muted small">
                    Cryptographic hardware binding protecting your matric number against proxy check-ins.
                  </p>
                </div>
                <Badge
                  tone={!needsInitialPasskeyBind && !deviceMismatch ? 'ok' : 'warn'}
                  icon={<SmartphoneIcon size={12} />}
                >
                  {!needsInitialPasskeyBind && !deviceMismatch ? 'Device Verified' : 'Attention Needed'}
                </Badge>
              </div>

              <div className="table-wrap">
                <table className="table">
                  <tbody>
                    <tr>
                      <th style={{ width: '210px' }}>Student Name</th>
                      <td>
                        <strong>{student.full_name}</strong>
                      </td>
                    </tr>
                    <tr>
                      <th>Matric Number</th>
                      <td className="mono">{student.matric_no}</td>
                    </tr>
                    <tr>
                      <th>Enrolled Cohort</th>
                      <td>{className}</td>
                    </tr>
                    <tr>
                      <th>Hardware Passkey ID</th>
                      <td className="mono">
                        {student.passkey_id ? `${student.passkey_id.slice(0, 18)}…` : 'Not bound yet'}
                      </td>
                    </tr>
                    <tr>
                      <th>Device Vault Token</th>
                      <td>
                        {deviceMismatch ? (
                          <div className="row" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
                            <Badge tone="warn">Needs Passkey Verification</Badge>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => void restorePasskeyAction.run()}
                              loading={restorePasskeyAction.pending}
                            >
                              Verify My Passkey
                            </Button>
                          </div>
                        ) : student.device_token ? (
                          <Badge tone="ok">Matched & Verified</Badge>
                        ) : (
                          <Badge tone="warn">Pending Setup</Badge>
                        )}
                      </td>
                    </tr>
                    <tr>
                      <th>Incognito Protection</th>
                      <td>
                        <Badge tone="ok">Enforced (Normal Mode Only)</Badge>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <p className="muted small">
                Your matric number is cryptographically locked to this phone’s hardware Passkey and persistent device vault. It will not work on another student’s phone or in Incognito mode. If you change or lose your phone, ask your Class Rep to click <strong>Reset phone</strong> next to your name on the class roster.
              </p>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
