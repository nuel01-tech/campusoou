import { useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Button, TextField } from '@/components/ui';

const STEPS = [
  {
    num: '01',
    title: 'Super Admin Enrolls Class Reps',
    text: 'The Super Admin sets up verified accounts for each department or level’s Class Representative. Public self-registration is locked so only authorized reps can manage classes.',
  },
  {
    num: '02',
    title: 'Class Rep Imports the Department List',
    text: 'The Class Rep uploads the class CSV or Excel sheet (Full Name + Matric Number) and shares the 6-character class code in the department group.',
  },
  {
    num: '03',
    title: 'Students Claim & Check In with Biometrics',
    text: 'Each student claims their account once by entering their name and matric number. When a session is live, they check in using Fingerprint, Face ID, or PIN inside the venue’s GPS radius.',
  },
  {
    num: '04',
    title: 'Vertical Weekly Attendance Export',
    text: 'At any time, the Class Rep downloads a clean Excel (.xlsx) or CSV register formatted with student names down the rows and Week 1, Week 2, Week 3… across the columns.',
  },
];

export function Landing() {
  const { ready, role } = useAuth();
  const navigate = useNavigate();
  const codeInputRef = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (ready && role === 'student') return <Navigate to="/me" replace />;
  if (ready && role === 'super_admin') return <Navigate to="/admin" replace />;
  if (ready && role === 'rep') return <Navigate to="/rep" replace />;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const clean = code.trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(clean)) {
      setError('The class code has 6 letters and numbers, e.g. K7PM3Q.');
      return;
    }
    navigate(`/join/${clean}`);
  };

  return (
    <div className="container landing">
      <section className="landing-hero">
        <div className="landing-intro">
          <p className="eyebrow">CampusPulse · Departmental Attendance Platform</p>
          <h1>Verified lecture attendance, without the paper sheets.</h1>
          <p className="lead">
            <strong>CampusPulse</strong> lets Class Representatives import their department roster, open GPS-fenced
            lecture sessions in seconds, and export a ready-to-submit weekly attendance register — while students verify
            their physical presence with their phone's <strong>Fingerprint / Face ID</strong> and <strong>GPS</strong>.
          </p>
          <div className="hero-actions">
            <Link to="/rep/login" className="btn btn-primary btn-lg">
              <span>Class Rep Sign In</span>
            </Link>
            <Link to="/admin/login" className="btn btn-secondary btn-lg">
              <span>Super Admin Portal</span>
            </Link>
            <button
              type="button"
              className="btn btn-ghost btn-lg"
              onClick={() => codeInputRef.current?.focus()}
            >
              <span>I'm a Student ↓</span>
            </button>
          </div>
        </div>
      </section>

      <section aria-labelledby="portals-heading" className="stack">
        <div className="section-head">
          <h2 id="portals-heading">Choose your portal</h2>
          <span className="muted small">Students, Class Representatives & Super Admin</span>
        </div>

        <div className="landing-grid-3">
          <article className="panel stack">
            <div>
              <p className="eyebrow">For Students</p>
              <h3>Claim account & check in</h3>
            </div>
            <p className="muted small">
              Enter the 6-character class code shared by your Class Rep to claim your matric number on this phone or
              check in to an open lecture.
            </p>
            <form onSubmit={submit} noValidate className="stack">
              <TextField
                ref={codeInputRef}
                label="6-character class code"
                value={code}
                onChange={(e) => {
                  setCode(e.target.value.toUpperCase());
                  setError(null);
                }}
                placeholder="K7PM3Q"
                autoCapitalize="characters"
                autoComplete="off"
                maxLength={6}
                inputMode="text"
                className="code-input"
                error={error}
              />
              <Button type="submit" size="lg" block>
                Continue as Student
              </Button>
            </form>
          </article>

          <article className="panel panel-quiet stack">
            <div>
              <p className="eyebrow">For Class Representatives</p>
              <h3>Manage roster & sessions</h3>
            </div>
            <p className="muted small">
              Sign in with the email and password created for you by the Super Admin. Upload your department's CSV/Excel
              list, set the venue GPS radius, and export weekly sheets.
            </p>
            <ul className="feature-bullets">
              <li>Import CSV or Excel student lists</li>
              <li>Open GPS-fenced sessions by course & venue</li>
              <li>Export vertical weekly sheets (Names × Weeks)</li>
            </ul>
            <div className="card-footer">
              <Link to="/rep/login" className="btn btn-secondary btn-lg btn-block">
                <span>Class Rep Sign In</span>
              </Link>
            </div>
          </article>

          <article className="panel panel-quiet stack">
            <div>
              <p className="eyebrow">For Super Admin</p>
              <h3>Department & Rep control</h3>
            </div>
            <p className="muted small">
              The Super Admin controls who can act as a Class Rep. Create Class Rep accounts, generate their login
              credentials, or suspend/remove access at any time.
            </p>
            <ul className="feature-bullets">
              <li>First-time master Super Admin setup</li>
              <li>One-click Class Rep account creation</li>
              <li>Monitor classes & students per rep</li>
            </ul>
            <div className="card-footer stack-xs">
              <Link to="/admin/login" className="btn btn-secondary btn-lg btn-block">
                <span>Super Admin Sign In</span>
              </Link>
              <Link to="/admin/setup" className="link-quiet center">
                First time setting up? Create Super Admin →
              </Link>
            </div>
          </article>
        </div>
      </section>

      <section aria-labelledby="how-heading" className="stack">
        <div className="section-head">
          <h2 id="how-heading">How CampusPulse works</h2>
          <span className="muted small">Four steps from roster upload to final weekly sheet</span>
        </div>

        <div className="steps-grid">
          {STEPS.map((s) => (
            <div key={s.num} className="step-card">
              <span className="step-num mono">{s.num}</span>
              <h3>{s.title}</h3>
              <p className="muted small">{s.text}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
