import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useAction, useAsync } from '@/hooks/useAsync';
import { useToast } from '@/hooks/useToast';
import { ensureStudentSession } from '@/services/auth';
import { claimStudent, findClassByCode, getMyEnrollment } from '@/services/student';
import {
  detectIncognitoMode,
  isInAppBrowser,
  isPasskeySupported,
  openInExternalBrowser,
  registerDevicePasskey,
} from '@/lib/webauthn';
import { Alert, Badge, Button, ErrorAlert, PageHeader, PageLoader, TextField } from '@/components/ui';
import { ArrowUpRightIcon, KeyRoundIcon, ShieldCheckIcon, SmartphoneIcon } from '@/components/icons';
import { titleCase } from '@/lib/names';

export function JoinPage() {
  const { code: rawCode } = useParams();
  const code = (rawCode ?? '').toUpperCase();

  if (!code) return <Navigate to="/" replace />;
  return <ClaimForm code={code} />;
}

function ClaimForm({ code }: { code: string }) {
  const { ready, role, refreshAuth } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [matric, setMatric] = useState('');
  const [name, setName] = useState('');
  const [touched, setTouched] = useState(false);

  const incognito = useAsync(detectIncognitoMode, []);
  const klass = useAsync(() => findClassByCode(code), [code]);
  // If this phone has already claimed, skip the form.
  const existing = useAsync(
    () => (ready && role === 'student' ? getMyEnrollment() : Promise.resolve(null)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ready],
  );

  const claim = useAction(async () => {
    // 1. Prompt hardware Passkey creation (Fingerprint / Face ID / PIN) FIRST!
    //    This ensures the student sets up their passkey right as they claim,
    //    and blocks Incognito mode or unsupported browsers before touching the DB.
    const { passkeyId, deviceToken } = await registerDevicePasskey(name, matric);

    // 2. Create/reuse anonymous auth session and strictly bind the passkey + device token in Postgres.
    await ensureStudentSession();
    return claimStudent(code, matric, name, passkeyId, deviceToken);
  });

  if (!ready || klass.loading || existing.loading || incognito.loading) return <PageLoader />;
  if (existing.data) return <Navigate to="/me" replace />;

  if (incognito.data) {
    return (
      <div className="container narrow stack">
        <Alert tone="error" title="Incognito / Private Browsing is Blocked">
          Student accounts are permanently bound to your phone and cannot be claimed or used in Incognito / Private mode.
          Please copy this link, close Incognito, and open it in your normal Chrome or Safari browser window.
        </Alert>
        <Link to="/" className="link-quiet">
          ← Back to home
        </Link>
      </div>
    );
  }

  if (!isPasskeySupported()) {
    return (
      <div className="container narrow stack">
        <Alert tone="error" title="Device Passkey Required">
          This browser does not support biometric/device Passkeys (WebAuthn). Please open this link directly in Chrome (on Android) or Safari (on iPhone) to bind your phone.
        </Alert>
        <Link to="/" className="link-quiet">
          ← Back to home
        </Link>
      </div>
    );
  }

  if (klass.error) {
    return (
      <div className="container narrow stack">
        <ErrorAlert
          error={klass.error}
          onRetry={klass.error.code === 'NETWORK' ? () => klass.reload() : undefined}
        />
        <Link to="/" className="link-quiet">
          ← Enter a different code
        </Link>
      </div>
    );
  }

  const matricError = touched && matric.trim().length < 2 ? 'Enter your matric number.' : null;
  const nameError =
    touched && name.trim().split(/\s+/).filter(Boolean).length < 2
      ? 'Enter at least your surname and first name.'
      : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (matric.trim().length < 2 || name.trim().split(/\s+/).filter(Boolean).length < 2) return;
    const student = await claim.run();
    if (student) {
      await refreshAuth();
      toast(`Passkey bound! Welcome, ${titleCase(student.full_name)}`);
      navigate('/me', { replace: true });
    }
  };

  return (
    <div className="container narrow stack">
      <PageHeader
        eyebrow={`Cohort Enrollment · Code ${code}`}
        title={klass.data?.name}
        subtitle={
          <span>
            Verify your identity against the official department list. When you tap below, your phone will prompt for your{' '}
            <strong>Fingerprint, Face ID, or Screen Lock</strong> to permanently bind this device to your matric number.
          </span>
        }
        back={{ to: '/', label: 'CampusPulse home' }}
      />

      <div className="row" style={{ gap: '0.45rem' }}>
        <Badge tone="ok" icon={<SmartphoneIcon size={12} />}>
          1 Phone = 1 Student
        </Badge>
        <Badge tone="info" icon={<KeyRoundIcon size={12} />}>
          Hardware Passkey Required
        </Badge>
      </div>

      {isInAppBrowser() && (
        <Alert
          tone="info"
          title="Opened from WhatsApp / In-App Browser"
          action={
            <Button
              size="sm"
              variant="secondary"
              type="button"
              onClick={() => openInExternalBrowser()}
            >
              <span>Open in Chrome / Browser</span>
              <ArrowUpRightIcon size={13} />
            </Button>
          }
        >
          You can claim your account right here, or tap <strong>Open in Chrome / Browser</strong> so your phone stays signed in inside your main browser for every lecture.
        </Alert>
      )}

      {role === 'rep' || role === 'super_admin' ? (
        <Alert tone="warning" title="You're signed in as staff">
          Sign out first, or open this link on the student's own phone.
        </Alert>
      ) : (
        <form onSubmit={submit} noValidate className="panel stack">
          <div>
            <h2>Claim Your Student Profile</h2>
            <p className="muted small">
              Enter your details exactly as your Class Representative uploaded them on the class roster.
            </p>
          </div>

          <TextField
            label="Matric number"
            value={matric}
            onChange={(e) => setMatric(e.target.value)}
            placeholder="e.g. CSC/2021/045"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            error={matricError}
            autoFocus
          />
          <TextField
            label="Full name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Surname and first name"
            autoComplete="name"
            hint="Order doesn't matter, as long as it matches the class list."
            error={nameError}
          />

          <ErrorAlert error={claim.error} />

          <Button type="submit" size="lg" block loading={claim.pending}>
            <ShieldCheckIcon size={16} />
            <span>
              {claim.pending
                ? 'Verifying Passkey & Binding Phone…'
                : 'Set Up Passkey & Claim My Account'}
            </span>
          </Button>
          <p className="fine-print">
            Strict Security: Once claimed, your matric number is locked to this phone’s hardware passkey and cannot be used on any other phone or in Incognito mode.
          </p>
        </form>
      )}
    </div>
  );
}
