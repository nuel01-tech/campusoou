import { useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Badge, Button, TextField } from '@/components/ui';
import {
  AwardIcon,
  Building2Icon,
  CheckCircle2Icon,
  FileSpreadsheetIcon,
  GraduationCapIcon,
  KeyRoundIcon,
  MapPinIcon,
  ShieldCheckIcon,
  SmartphoneIcon,
  UsersIcon,
} from '@/components/icons';

const STEPS = [
  {
    num: 'STEP 01',
    title: 'Super Admin Provisions Class Reps',
    text: 'The Super Admin configures university departments and creates verified Class Representative accounts per academic level (100L–600L). Public self-registration is locked.',
  },
  {
    num: 'STEP 02',
    title: 'Class Rep Imports the Department Roster',
    text: 'The Class Rep uploads the official CSV or Excel sheet (Full Name + Matric Number) and shares the 6-character cohort code in the class WhatsApp group.',
  },
  {
    num: 'STEP 03',
    title: 'Hardware Passkey & GPS Venue Check-In',
    text: 'Each student claims their matric number once on their phone with Fingerprint, Face ID, or PIN (WebAuthn). During lectures, attendance is verified inside the GPS venue radius.',
  },
  {
    num: 'STEP 04',
    title: '75% Eligibility & Weekly Excel Matrix',
    text: 'CampusPulse automatically tracks the 75% NUC exam eligibility benchmark, flags defaulters, and exports a clean vertical weekly register (Names × Weeks).',
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
          <p className="eyebrow">CampusPulse · Smart University Attendance Management</p>
          <h1>Biometric & GPS-verified lecture attendance for modern universities.</h1>
          <p className="lead">
            Built for <strong>Olabisi Onabanjo University (OOU)</strong> departments. Class Representatives import
            their official student list, launch GPS-fenced lecture sessions in seconds, track 75% NUC exam eligibility,
            and export submission-ready weekly Excel registers — while students check in with their phone’s{' '}
            <strong>Fingerprint / Face ID Passkey</strong>.
          </p>

          <div className="hero-pills">
            <span className="hero-pill">
              <MapPinIcon size={14} />
              <span>GPS Venue Geofencing</span>
            </span>
            <span className="hero-pill">
              <KeyRoundIcon size={14} />
              <span>WebAuthn Hardware Passkey</span>
            </span>
            <span className="hero-pill">
              <SmartphoneIcon size={14} />
              <span>1 Phone = 1 Student Lock</span>
            </span>
            <span className="hero-pill">
              <AwardIcon size={14} />
              <span>75% NUC Exam Eligibility</span>
            </span>
          </div>

          <div className="hero-actions">
            <Link to="/student/login" className="btn btn-secondary btn-lg">
              <span>Student Sign In</span>
            </Link>
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
              <span>Student Check-In →</span>
            </button>
          </div>
        </div>

        <aside className="hero-card" aria-label="Quick student class code entry">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <Badge tone="ok" icon={<SmartphoneIcon size={12} />}>
              Student Portal
            </Badge>
            <span className="mono muted small">WebAuthn + GPS</span>
          </div>
          <div>
            <h2>Have a 6-character class code?</h2>
            <p className="muted small" style={{ marginTop: '0.2rem' }}>
              Enter the cohort code shared by your Class Representative to claim your matric number on this phone or
              check in to a live lecture.
            </p>
          </div>
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
          <p className="fine-print center">
            Protected against proxy check-ins and Incognito browsing.
          </p>
        </aside>
      </section>

      <section aria-labelledby="portals-heading" className="stack">
        <div className="section-head">
          <div>
            <p className="eyebrow">Role-Based Workspaces</p>
            <h2 id="portals-heading">Designed for every academic stakeholder</h2>
          </div>
          <span className="muted small">Students · Class Representatives · Super Administrator</span>
        </div>

        <div className="landing-grid-3">
          <article className="panel stack">
            <div>
              <div className="row" style={{ justifyContent: 'space-between', marginBottom: '0.4rem' }}>
                <p className="eyebrow" style={{ margin: 0 }}>
                  01 · Student Experience
                </p>
                <GraduationCapIcon size={18} className="muted" />
              </div>
              <h3>One-time claim & instant check-in</h3>
            </div>
            <p className="muted small">
              Students never need passwords or email confirmations. Claim your matric number once using your phone’s
              biometric passkey, then check in whenever a lecture session opens.
            </p>
            <ul className="feature-bullets">
              <li>Hardware Passkey (Fingerprint / Face ID / PIN) binding</li>
              <li>Real-time GPS distance & venue verification</li>
              <li>Complete personal attendance history log</li>
            </ul>
            <div className="card-footer">
              <Button
                type="button"
                variant="secondary"
                size="lg"
                block
                onClick={() => codeInputRef.current?.focus()}
              >
                Enter Student Class Code
              </Button>
            </div>
          </article>

          <article className="panel stack">
            <div>
              <div className="row" style={{ justifyContent: 'space-between', marginBottom: '0.4rem' }}>
                <p className="eyebrow" style={{ margin: 0 }}>
                  02 · Class Representative
                </p>
                <UsersIcon size={18} className="muted" />
              </div>
              <h3>Cohort roster, live sessions & exports</h3>
            </div>
            <p className="muted small">
              Manage your department cohort with zero paperwork. Upload Excel/CSV rosters, run live GPS roll-calls,
              automatically mark Class Reps present, and export weekly matrices.
            </p>
            <ul className="feature-bullets">
              <li>Import CSV/Excel student lists with validation</li>
              <li>Live GPS session control, QR projector & batch roll-call</li>
              <li>75% exam eligibility analytics & WhatsApp warnings</li>
            </ul>
            <div className="card-footer">
              <Link to="/rep/login" className="btn btn-primary btn-lg btn-block">
                <span>Class Rep Sign In</span>
              </Link>
            </div>
          </article>

          <article className="panel stack">
            <div>
              <div className="row" style={{ justifyContent: 'space-between', marginBottom: '0.4rem' }}>
                <p className="eyebrow" style={{ margin: 0 }}>
                  03 · Super Administrator
                </p>
                <Building2Icon size={18} className="muted" />
              </div>
              <h3>University department & rep governance</h3>
            </div>
            <p className="muted small">
              Centralized oversight across all university departments and academic levels. Create departments,
              provision Class Rep credentials, and audit anti-proxy device logs.
            </p>
            <ul className="feature-bullets">
              <li>Create & manage university departments (100L–600L)</li>
              <li>One-click Class Rep provisioning & WhatsApp sharing</li>
              <li>Live campus sessions monitor & device security audit</li>
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

      <section aria-labelledby="security-heading" className="panel stack">
        <div className="section-head">
          <div>
            <p className="eyebrow">Anti-Proxy Architecture</p>
            <h2 id="security-heading">How CampusPulse eliminates proxy attendance</h2>
          </div>
          <Badge tone="ok" icon={<ShieldCheckIcon size={13} />}>
            Cryptographic Verification
          </Badge>
        </div>
        <div className="landing-grid-3">
          <div className="stack-xs">
            <div className="row">
              <KeyRoundIcon size={16} />
              <h3>Hardware WebAuthn Passkeys</h3>
            </div>
            <p className="muted small">
              Each student’s matric number is cryptographically bound to their phone’s secure hardware enclave using
              Fingerprint, Face ID, or device lock — preventing a friend from signing in on their behalf.
            </p>
          </div>
          <div className="stack-xs">
            <div className="row">
              <MapPinIcon size={16} />
              <h3>Live GPS Venue Geofencing</h3>
            </div>
            <p className="muted small">
              When a Class Rep opens a session inside the lecture hall, CampusPulse locks the venue coordinates and
              radius (e.g. 50m) and verifies student distance and GPS accuracy on check-in.
            </p>
          </div>
          <div className="stack-xs">
            <div className="row">
              <FileSpreadsheetIcon size={16} />
              <h3>Ready-to-Submit Weekly Registers</h3>
            </div>
            <p className="muted small">
              Download clean `.xlsx` or `.csv` attendance sheets with students sorted alphabetically down the rows and
              Week 1, Week 2, Week 3… across the columns, plus automatic 75% exam eligibility calculation.
            </p>
          </div>
        </div>
      </section>

      <section aria-labelledby="how-heading" className="stack">
        <div className="section-head">
          <div>
            <p className="eyebrow">End-to-End Workflow</p>
            <h2 id="how-heading">Four steps from roster upload to final weekly sheet</h2>
          </div>
          <span className="muted small">Built for fast mobile connections</span>
        </div>

        <div className="steps-grid">
          {STEPS.map((s) => (
            <div key={s.num} className="step-card">
              <span className="step-num mono">
                <CheckCircle2Icon size={12} />
                {s.num}
              </span>
              <h3>{s.title}</h3>
              <p className="muted small">{s.text}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="landing-footer">
        <span>
          <strong>CampusPulse</strong> — Smart University Attendance Management · Olabisi Onabanjo University (OOU)
        </span>
        <span>GPS Geofencing · WebAuthn Passkeys · 75% NUC Compliance</span>
      </footer>
    </div>
  );
}
