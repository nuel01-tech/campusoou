import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAction, useAsync } from '@/hooks/useAsync';
import { getClass } from '@/services/classes';
import { createSession, listSessions } from '@/services/sessions';
import { locate } from '@/lib/geo';
import { toAppError, type AppError } from '@/lib/errors';
import { weekFor } from '@/lib/week';
import { Alert, Button, ErrorAlert, PageHeader, PageLoader, SelectField, TextField } from '@/components/ui';
import { MapPinIcon, RefreshCwIcon } from '@/components/icons';
import type { GeoFix } from '@/types';

const RADII = [30, 50, 100, 200, 500];
const DURATIONS = [10, 15, 30, 60, 120, 180];

export default function NewSessionPage() {
  const { classId = '' } = useParams();
  const data = useAsync(
    async () => {
      const [klass, sessions] = await Promise.all([getClass(classId), listSessions(classId)]);
      return { klass, sessions };
    },
    [classId],
  );

  if (data.loading) return <PageLoader />;
  if (data.error || !data.data) {
    return (
      <div className="container narrow">
        <ErrorAlert error={data.error} onRetry={() => data.reload()} />
      </div>
    );
  }
  return <NewSessionForm {...data.data} />;
}

function NewSessionForm({ klass, sessions }: Awaited<ReturnType<typeof loadShape>>) {
  const navigate = useNavigate();
  const last = sessions[0];

  // Suggestions from previous sessions, most recent first.
  const pastCourses = useMemo(() => [...new Set(sessions.map((s) => s.course_code))], [sessions]);
  const pastVenues = useMemo(() => [...new Set(sessions.map((s) => s.venue))], [sessions]);
  const suggestedWeek = weekFor(new Date(), klass.semester_start) ?? last?.week ?? 1;

  const [course, setCourse] = useState(last?.course_code ?? '');
  const [venue, setVenue] = useState(last?.venue ?? '');
  const [week, setWeek] = useState(String(suggestedWeek));
  const [radius, setRadius] = useState(String(last?.radius_m ?? 50));
  const [duration, setDuration] = useState('15');
  const [touched, setTouched] = useState(false);

  const [fix, setFix] = useState<GeoFix | null>(null);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<AppError | null>(null);

  const findMe = async () => {
    setLocating(true);
    setGeoError(null);
    try {
      setFix(await locate({ targetAccuracy: 20, timeoutMs: 15_000 }));
    } catch (e) {
      setGeoError(toAppError(e));
    } finally {
      setLocating(false);
    }
  };

  useEffect(() => {
    void findMe();
  }, []);

  const create = useAction(() =>
    createSession({
      class_id: klass.id,
      course_code: course,
      venue,
      lat: fix!.lat,
      lng: fix!.lng,
      radius_m: Number(radius),
      week: Number(week),
      duration_min: Number(duration),
    }),
  );

  const weekNum = Number(week);
  const errors = {
    course: course.trim().length < 2 ? 'Enter the course code.' : null,
    venue: venue.trim().length < 1 ? 'Enter the venue.' : null,
    week: !Number.isInteger(weekNum) || weekNum < 1 || weekNum > 52 ? 'Week must be between 1 and 52.' : null,
  };
  const valid = !errors.course && !errors.venue && !errors.week && fix;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!valid) return;
    const session = await create.run();
    if (session) navigate(`/rep/session/${session.id}`, { replace: true });
  };

  return (
    <div className="container narrow stack">
      <PageHeader
        eyebrow="GPS Lecture Roll-Call"
        title="Start a Lecture Session"
        subtitle={`${klass.name} · Stand inside the venue so your phone captures the exact lecture hall coordinates.`}
        back={{ to: `/rep/class/${klass.id}`, label: klass.name }}
      />

      <form onSubmit={submit} noValidate className="panel stack">
        <div className="grid-2">
          <TextField
            label="Course code"
            value={course}
            onChange={(e) => setCourse(e.target.value.toUpperCase())}
            placeholder="CSC 301"
            list="course-options"
            autoCapitalize="characters"
            error={touched ? errors.course : null}
            maxLength={20}
          />
          <TextField
            label="Week"
            type="number"
            inputMode="numeric"
            min={1}
            max={52}
            value={week}
            onChange={(e) => setWeek(e.target.value)}
            error={touched ? errors.week : null}
            hint={klass.semester_start ? 'Calculated from semester start date.' : undefined}
          />
        </div>
        <datalist id="course-options">
          {pastCourses.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>

        <TextField
          label="Lecture venue"
          value={venue}
          onChange={(e) => setVenue(e.target.value)}
          placeholder="e.g. LT 2 / Hall B"
          list="venue-options"
          error={touched ? errors.venue : null}
          maxLength={120}
        />
        <datalist id="venue-options">
          {pastVenues.map((v) => (
            <option key={v} value={v} />
          ))}
        </datalist>

        <div className="grid-2">
          <SelectField
            label="GPS check-in radius"
            value={radius}
            onChange={(e) => setRadius(e.target.value)}
            hint="50 m covers most lecture halls."
          >
            {RADII.map((r) => (
              <option key={r} value={r}>
                {r} m
              </option>
            ))}
          </SelectField>
          <SelectField label="Session duration" value={duration} onChange={(e) => setDuration(e.target.value)}>
            {DURATIONS.map((d) => (
              <option key={d} value={d}>
                {d < 60 ? `${d} minutes` : `${d / 60} hour${d > 60 ? 's' : ''}`}
              </option>
            ))}
          </SelectField>
        </div>

        <LocationBox fix={fix} locating={locating} error={geoError} onRetry={findMe} showMissing={touched} />

        <ErrorAlert error={create.error} />

        <Button type="submit" size="lg" block loading={create.pending} disabled={locating}>
          <MapPinIcon size={16} />
          <span>Start Live GPS Session</span>
        </Button>
      </form>
    </div>
  );
}

function LocationBox({
  fix,
  locating,
  error,
  onRetry,
  showMissing,
}: {
  fix: GeoFix | null;
  locating: boolean;
  error: AppError | null;
  onRetry: () => void;
  showMissing: boolean;
}) {
  if (locating) {
    return (
      <Alert tone="info" title="Acquiring GPS coordinates…">
        Stand inside the venue. The session centre is set to where you are now.
      </Alert>
    );
  }
  if (error) {
    return (
      <Alert
        tone="error"
        title="Location needed"
        action={
          <Button size="sm" variant="secondary" type="button" onClick={onRetry}>
            Try again
          </Button>
        }
      >
        {error.message}
      </Alert>
    );
  }
  if (!fix) {
    return showMissing ? <Alert tone="error">Set the venue location before starting.</Alert> : null;
  }
  const rough = fix.accuracy > 50;
  return (
    <Alert
      tone={rough ? 'warning' : 'success'}
      title={`GPS Location Locked · ±${Math.round(fix.accuracy)} m accuracy`}
      action={
        <Button size="sm" variant="secondary" type="button" onClick={onRetry}>
          <RefreshCwIcon size={13} />
          <span>Refresh</span>
        </Button>
      }
    >
      {rough
        ? 'That is a rough reading. Move closer to a window or refresh, or choose a larger radius.'
        : 'Students must be within the radius of this point to verify attendance.'}
      <br />
      <Link
        className="small"
        to={`https://www.openstreetmap.org/?mlat=${fix.lat}&mlon=${fix.lng}#map=19/${fix.lat}/${fix.lng}`}
        target="_blank"
        rel="noreferrer"
      >
        View coordinates on OpenStreetMap →
      </Link>
    </Alert>
  );
}

// Type helper for the loaded data shape.
async function loadShape() {
  const klass = await getClass('');
  const sessions = await listSessions('');
  return { klass, sessions };
}
