import { useState } from 'react';
import { checkIn } from '@/services/student';
import { locate } from '@/lib/geo';
import { verifyDevicePasskey } from '@/lib/webauthn';
import { toAppError, type AppError } from '@/lib/errors';
import { formatTime, timeLeft } from '@/lib/format';
import { Alert, Badge, Button, StatusPill } from '@/components/ui';
import { Clock3Icon, KeyRoundIcon, MapPinIcon, ShieldCheckIcon } from '@/components/icons';
import type { Attendance, Session, Student } from '@/types';

type Phase = 'idle' | 'auth' | 'locating' | 'sending';

interface Props {
  session: Session;
  student: Student;
  checkedIn: Attendance | undefined;
  now: number;
  onCheckedIn: (row: Attendance) => void;
}

export function CheckInCard({ session, student, checkedIn, now, onCheckedIn }: Props) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<AppError | null>(null);
  const [lastFix, setLastFix] = useState<{ accuracy: number } | null>(null);

  const run = async () => {
    setError(null);
    try {
      setPhase('auth');
      // 1. Verify the exact hardware passkey & persistent device token bound during claim,
      //    and generate a cryptographic WebAuthn assertion proof bound to this session.
      const { passkeyId, deviceToken, webauthnProof } = await verifyDevicePasskey(
        student.passkey_id,
        student.device_token,
        session.id,
      );

      setPhase('locating');
      const fix = await locate();
      setLastFix({ accuracy: Math.round(fix.accuracy) });

      setPhase('sending');
      const row = await checkIn(
        session.id,
        fix,
        passkeyId,
        deviceToken,
        webauthnProof,
      );
      onCheckedIn(row);
    } catch (e) {
      const err = toAppError(e);
      // Server says we're already in: treat it as success from the student's view.
      if (err.code === 'ALREADY_CHECKED_IN') {
        onCheckedIn({
          id: 'local',
          session_id: session.id,
          student_id: student.id,
          checked_in_at: new Date().toISOString(),
          distance_m: null,
          accuracy_m: lastFix?.accuracy ?? null,
          manual: false,
        });
      } else setError(err);
    } finally {
      setPhase('idle');
    }
  };

  const busy = phase !== 'idle';

  return (
    <article className={`checkin-card ${checkedIn ? 'is-done' : ''}`}>
      <div className="checkin-head">
        <div>
          <div className="row" style={{ gap: '0.45rem', marginBottom: '0.25rem' }}>
            <Badge tone="live">Live Session · Week {session.week}</Badge>
            <Badge tone="neutral" icon={<MapPinIcon size={11} />}>
              {session.radius_m}m GPS Geofence
            </Badge>
          </div>
          <p className="checkin-course">{session.course_code}</p>
          <p className="checkin-venue">
            <MapPinIcon size={14} />
            <span>Venue: {session.venue}</span>
          </p>
        </div>
        <span className="checkin-time">
          <Clock3Icon size={12} style={{ verticalAlign: '-2px', marginRight: '4px' }} />
          {timeLeft(session.ends_at, now)}
        </span>
      </div>

      <div className="checkin-meta-pills">
        <Badge tone="info" icon={<KeyRoundIcon size={11} />}>
          Passkey Verification Required
        </Badge>
        <Badge tone="ok" icon={<ShieldCheckIcon size={11} />}>
          Anti-Spoof & Anti-VPN Shield Active
        </Badge>
        {checkedIn?.distance_m != null && (
          <Badge tone="ok" icon={<MapPinIcon size={11} />}>
            Distance: {Math.round(checkedIn.distance_m)}m from venue
          </Badge>
        )}
        {(checkedIn?.accuracy_m != null || lastFix?.accuracy != null) && (
          <Badge tone="neutral">
            GPS Accuracy: ±{Math.round(checkedIn?.accuracy_m ?? lastFix!.accuracy)}m
          </Badge>
        )}
      </div>

      {checkedIn ? (
        <div className="checkin-done" role="status">
          <span className="tick" aria-hidden="true" />
          <div style={{ flex: 1 }}>
            <strong>Attendance Verified & Recorded</strong>
            <div className="small muted">
              Checked in at {formatTime(checkedIn.checked_in_at)}
              {checkedIn.distance_m != null ? ` · ${Math.round(checkedIn.distance_m)}m from lecture hall` : ''}
            </div>
          </div>
          <StatusPill status="present" label="Completed" />
        </div>
      ) : (
        <>
          <Button size="lg" block onClick={run} loading={busy} disabled={student.suspended}>
            <ShieldCheckIcon size={16} />
            <span>
              {phase === 'auth'
                ? 'Verifying Bound Passkey…'
                : phase === 'locating'
                  ? 'Measuring GPS Distance & Accuracy…'
                  : phase === 'sending'
                    ? 'Recording Attendance…'
                    : 'Verify Passkey & Check In Now'}
            </span>
          </Button>
          {phase === 'auth' && (
            <p className="fine-print center">
              Confirm your registered Fingerprint, Face ID, or screen lock for this phone.
            </p>
          )}
          {phase === 'locating' && (
            <p className="fine-print center">
              Acquiring high-accuracy GPS coordinates inside {session.venue} ({session.radius_m}m radius)…
            </p>
          )}
          {error && <Alert tone="error">{error.message}</Alert>}
        </>
      )}
    </article>
  );
}
