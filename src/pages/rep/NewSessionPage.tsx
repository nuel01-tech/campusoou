import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAction, useAsync } from '@/hooks/useAsync';
import { getClass } from '@/services/classes';
import { createSession, listSessions } from '@/services/sessions';
import { locate } from '@/lib/geo';
import { toAppError, type AppError } from '@/lib/errors';
import { dateForSemesterWeek, SEMESTER_WEEKS, weekFor } from '@/lib/week';
import {
  Alert,
  Badge,
  Button,
  ErrorAlert,
  PageHeader,
  PageLoader,
  SelectField,
  TextField,
} from '@/components/ui';
import {
  CheckCircle2Icon,
  ClipboardCheckIcon,
  MapPinIcon,
  RefreshCwIcon,
} from '@/components/icons';
import type { GeoFix } from '@/types';

const RADII = [30, 50, 100, 200, 500];
const DURATIONS = [10, 15, 30, 60, 120, 180];
// Default OOU Ago-Iwoye campus coordinates used when backfilling a past week without live GPS
const DEFAULT_CAMPUS_LAT = 6.9298;
const DEFAULT_CAMPUS_LNG = 3.9165;

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
  const [searchParams] = useSearchParams();
  const last = sessions[0];

  const paramWeek = Number(searchParams.get('week'));
  const paramMode = searchParams.get('mode');
  const paramCourse = searchParams.get('course');

  // Suggestions from previous sessions, most recent first.
  const pastCourses = useMemo(() => [...new Set(sessions.map((s) => s.course_code))], [sessions]);
  const pastVenues = useMemo(() => [...new Set(sessions.map((s) => s.venue))], [sessions]);

  const suggestedWeek =
    Number.isInteger(paramWeek) && paramWeek >= 1 && paramWeek <= 52
      ? paramWeek
      : (weekFor(new Date(), klass.semester_start) ?? last?.week ?? 1);

  const [isBackfill, setIsBackfill] = useState<boolean>(paramMode === 'backfill');
  const [course, setCourse] = useState(paramCourse?.toUpperCase() || last?.course_code || '');
  const [venue, setVenue] = useState(last?.venue ?? 'Lecture Hall');
  const [week, setWeek] = useState(String(suggestedWeek));
  const [sessionDate, setSessionDate] = useState<string>(
    () =>
      dateForSemesterWeek(suggestedWeek, klass.semester_start) ??
      new Date().toISOString().slice(0, 10),
  );
  const [radius, setRadius] = useState(String(last?.radius_m ?? 50));
  const [duration, setDuration] = useState('15');
  const [touched, setTouched] = useState(false);

  const [fix, setFix] = useState<GeoFix | null>(null);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<AppError | null>(null);

  // Track which of the 15 weeks already have sessions (for the typed course, or across all courses if blank)
  const weeksWithSessions = useMemo(() => {
    const cleanCourse = course.trim().toUpperCase();
    const relevant = cleanCourse
      ? sessions.filter((s) => s.course_code.toUpperCase() === cleanCourse)
      : sessions;
    const counts = new Map<number, number>();
    for (const s of relevant) {
      counts.set(s.week, (counts.get(s.week) ?? 0) + 1);
    }
    return counts;
  }, [sessions, course]);

  const findMe = async () => {
    setLocating(true);
    setGeoError(null);
    try {
      setFix(await locate({ targetAccuracy: 20, timeoutMs: 45_000 }));
    } catch (e) {
      setGeoError(toAppError(e));
    } finally {
      setLocating(false);
    }
  };

  useEffect(() => {
    if (!isBackfill) {
      void findMe();
    }
  }, [isBackfill]);

  const handleSelectWeek = (w: number) => {
    setWeek(String(w));
    const calcDate = dateForSemesterWeek(w, klass.semester_start);
    if (calcDate) {
      setSessionDate(calcDate);
    }
  };

  const create = useAction(() =>
    createSession({
      class_id: klass.id,
      course_code: course,
      venue,
      lat: fix?.lat ?? last?.lat ?? DEFAULT_CAMPUS_LAT,
      lng: fix?.lng ?? last?.lng ?? DEFAULT_CAMPUS_LNG,
      radius_m: Number(radius),
      week: Number(week),
      duration_min: Number(duration),
      is_backfill: isBackfill,
      session_date: isBackfill ? sessionDate : undefined,
    }),
  );

  const weekNum = Number(week);
  const errors = {
    course: course.trim().length < 2 ? 'Enter the course code.' : null,
    venue: venue.trim().length < 1 ? 'Enter the venue.' : null,
    week:
      !Number.isInteger(weekNum) || weekNum < 1 || weekNum > 52
        ? 'Week must be between 1 and 52.'
        : null,
  };
  const valid = !errors.course && !errors.venue && !errors.week && (isBackfill || Boolean(fix));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!valid) return;
    const session = await create.run();
    if (session) {
      navigate(
        isBackfill ? `/rep/session/${session.id}?manual=1` : `/rep/session/${session.id}`,
        { replace: true },
      );
    }
  };

  return (
    <div className="container narrow stack">
      <PageHeader
        eyebrow={isBackfill ? 'Past / Omitted Week Backfill' : 'GPS Lecture Roll-Call'}
        title={isBackfill ? `Log & Mark Past Session (Week ${week})` : 'Start a Lecture Session'}
        subtitle={
          isBackfill
            ? `${klass.name} Â· Select any omitted semester week (Week 1 â€“ 15) to create its record and manually mark student attendance.`
            : `${klass.name} Â· Stand inside the venue so your phone captures the exact lecture hall coordinates.`
        }
        back={{ to: `/rep/class/${klass.id}`, label: klass.name }}
      />

      <form onSubmit={submit} noValidate className="panel stack">
        {/* Session Mode Switcher: Live GPS vs Past/Omitted Week Manual Backfill */}
        <div className="stack-xs">
          <span className="field-label">Session Mode</span>
          <div className="segmented" role="tablist" aria-label="Session mode">
            <button
              type="button"
              role="tab"
              aria-selected={!isBackfill}
              className={!isBackfill ? 'is-active' : ''}
              onClick={() => setIsBackfill(false)}
            >
              Live GPS Roll-Call (Now)
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={isBackfill}
              className={isBackfill ? 'is-active' : ''}
              onClick={() => setIsBackfill(true)}
            >
              Past / Omitted Week (Manual Mark)
            </button>
          </div>
        </div>

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
            label="Lecture venue"
            value={venue}
            onChange={(e) => setVenue(e.target.value)}
            placeholder="e.g. LT 2 / Hall B"
            list="venue-options"
            error={touched ? errors.venue : null}
            maxLength={120}
          />
        </div>
        <datalist id="course-options">
          {pastCourses.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <datalist id="venue-options">
          {pastVenues.map((v) => (
            <option key={v} value={v} />
          ))}
        </datalist>

        {/* 15-Week Semester Picker showing which weeks already have sessions */}
        <div className="stack-xs">
          <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <span className="field-label">
              Select Semester Week (Week 1 â€“ Week 15)
              {course.trim() ? ` Â· ${course.trim().toUpperCase()}` : ''}
            </span>
            <span className="muted small">
              Green = session already recorded Â· Grey = omitted / no session yet
            </span>
          </div>

          <div className="week-pill-grid" role="radiogroup" aria-label="Choose semester week 1 to 15">
            {SEMESTER_WEEKS.map((w) => {
              const heldCount = weeksWithSessions.get(w) ?? 0;
              const isSelected = weekNum === w;
              return (
                <button
                  key={w}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  onClick={() => handleSelectWeek(w)}
                  className={[
                    'week-pill-btn',
                    heldCount > 0 ? 'has-session' : 'no-session',
                    isSelected && 'is-selected',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <span className="week-pill-title mono">W{w}</span>
                  <span className="week-pill-sub">
                    {heldCount > 0 ? (
                      <span className="row" style={{ gap: '0.2rem', justifyContent: 'center' }}>
                        <CheckCircle2Icon size={10} />
                        <span>{heldCount > 1 ? `${heldCount}Ã—` : 'Held'}</span>
                      </span>
                    ) : (
                      'Empty'
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid-2">
          <SelectField
            label="Selected Week Number"
            value={week}
            onChange={(e) => handleSelectWeek(Number(e.target.value))}
            hint="Standard semesters have 15 weeks (Week 1 â€“ Week 15)."
          >
            {SEMESTER_WEEKS.map((w) => {
              const heldCount = weeksWithSessions.get(w) ?? 0;
              return (
                <option key={w} value={w}>
                  Week {w} {heldCount > 0 ? `(âœ“ ${heldCount} session${heldCount > 1 ? 's' : ''} recorded)` : '(No session yet â€” Omitted)'}
                </option>
              );
            })}
            {Array.from({ length: 37 }, (_, i) => i + 16).map((w) => (
              <option key={w} value={w}>
                Week {w} (Extended)
              </option>
            ))}
          </SelectField>

          {isBackfill && (
            <TextField
              label="Lecture Date (Past / Omitted Date)"
              type="date"
              value={sessionDate}
              onChange={(e) => setSessionDate(e.target.value)}
              hint="Date to record on the attendance log for this week."
            />
          )}
        </div>

        {!isBackfill ? (
          <>
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
              <SelectField
                label="Session duration"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
              >
                {DURATIONS.map((d) => (
                  <option key={d} value={d}>
                    {d < 60 ? `${d} minutes` : `${d / 60} hour${d > 60 ? 's' : ''}`}
                  </option>
                ))}
              </SelectField>
            </div>

            <LocationBox
              fix={fix}
              locating={locating}
              error={geoError}
              onRetry={findMe}
              showMissing={touched}
            />
          </>
        ) : (
          <Alert tone="info" title={`Backfilling Omitted Week ${week}`}>
            This creates a recorded session for <strong>Week {week}</strong> without opening a live GPS window, and takes you straight to the student list so you can manually mark everyone who attended (individually or in bulk with{' '}
            <strong>Batch Roll-Call</strong>).
            { (weeksWithSessions.get(weekNum) ?? 0) > 0 && (
              <div style={{ marginTop: '0.4rem' }}>
                <Badge tone="warn">
                  Note: Week {week} already has {weeksWithSessions.get(weekNum)} session(s) recorded{course.trim() ? ` for ${course.trim().toUpperCase()}` : ''}.
                </Badge>
              </div>
            )}
          </Alert>
        )}

        <ErrorAlert error={create.error} />

        <Button
          type="submit"
          size="lg"
          block
          loading={create.pending}
          disabled={!isBackfill && locating}
        >
          {isBackfill ? <ClipboardCheckIcon size={16} /> : <MapPinIcon size={16} />}
          <span>
            {isBackfill
              ? `Create Week ${week} Record & Mark Students Manually â†’`
              : `Start Live GPS Session (Week ${week})`}
          </span>
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
      <Alert tone="info" title="Acquiring GPS coordinatesâ€¦">
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
      title={`GPS Location Locked Â· Â±${Math.round(fix.accuracy)} m accuracy`}
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
        View coordinates on OpenStreetMap â†’
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
