import { useState } from 'react';
import { checkIn } from '@/services/student';
import { locate } from '@/lib/geo';
import { verifyDevicePasskey } from '@/lib/webauthn';
import { toAppError, type AppError } from '@/lib/errors';
import { formatTime, timeLeft } from '@/lib/format';
import { Alert, Button } from '@/components/ui';
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

  const run = async () => {
    setError(null);
    try {
      setPhase('auth');
      // 1. Verify the exact hardware passkey & persistent device token bound during claim
      const { passkeyId, deviceToken } = await verifyDevicePasskey(
        student.passkey_id,
        student.device_token,
      );

      setPhase('locating');
      const fix = await locate();

      setPhase('sending');
      const row = await checkIn(session.id, fix, passkeyId, deviceToken);
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
          accuracy_m: null,
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
          <p className="checkin-course">{session.course_code}</p>
          <p className="checkin-venue">{session.venue}</p>
        </div>
        <p className="checkin-time">{timeLeft(session.ends_at, now)}</p>
      </div>

      {checkedIn ? (
        <div className="checkin-done" role="status">
          <span className="tick" aria-hidden="true" />
          <div>
            <strong>You're checked in</strong>
            <span className="muted"> at {formatTime(checkedIn.checked_in_at)}</span>
          </div>
        </div>
      ) : (
        <>
          <Button size="lg" block onClick={run} loading={busy}>
            {phase === 'auth'
              ? 'Verifying Bound Passkey…'
              : phase === 'locating'
                ? 'Getting your GPS location…'
                : phase === 'sending'
                  ? 'Recording attendance…'
                  : 'Verify Passkey & Check In'}
          </Button>
          {phase === 'auth' && (
            <p className="fine-print center">
              Confirm your registered Fingerprint, Face ID, or screen lock for this phone.
            </p>
          )}
          {phase === 'locating' && (
            <p className="fine-print center">Allow location if your phone asks. This takes a few seconds.</p>
          )}
          {error && <Alert tone="error">{error.message}</Alert>}
        </>
      )}
    </article>
  );
}
