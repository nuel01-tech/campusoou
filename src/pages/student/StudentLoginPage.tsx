import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { signInStudent } from '@/services/auth';
import { toAppError } from '@/lib/errors';
import { Alert, Badge, Button, ErrorAlert, PageHeader, PageLoader, TextField } from '@/components/ui';
import { KeyRoundIcon, ShieldCheckIcon, SmartphoneIcon } from '@/components/icons';

export function StudentLoginPage() {
  const { ready, role, refreshAuth } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ReturnType<typeof toAppError> | null>(null);

  if (!ready) return <PageLoader />;
  if (role === 'student') return <Navigate to="/me" replace />;
  if (role === 'rep') return <Navigate to="/rep" replace />;
  if (role === 'super_admin') return <Navigate to="/admin" replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signInStudent(email, password);
      await refreshAuth();
      navigate('/me', { replace: true });
    } catch (err) {
      setError(toAppError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container narrow stack">
      <PageHeader
        eyebrow="Student Portal · Account Access"
        title="Sign in to CampusPulse"
        subtitle="Sign in with the email address and password you configured in My Profile after claiming your student account."
        back={{ to: '/', label: 'CampusPulse home' }}
      />

      <div className="row" style={{ gap: '0.45rem' }}>
        <Badge tone="ok" icon={<SmartphoneIcon size={12} />}>
          Student Portal
        </Badge>
        <Badge tone="info" icon={<KeyRoundIcon size={12} />}>
          Passkey & GPS Protected
        </Badge>
      </div>

      <form onSubmit={submit} className="panel stack">
        <div>
          <h2>Student Sign In</h2>
          <p className="muted small">
            Enter the login email and password linked to your claimed matric number.
          </p>
        </div>

        <TextField
          label="Email address"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="student@oouagoiwoye.edu.ng"
          autoComplete="email"
          required
          autoFocus
        />
        <TextField
          label="Password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Enter your password"
          autoComplete="current-password"
          required
        />

        <ErrorAlert error={error} />

        <Button type="submit" size="lg" block loading={busy} disabled={!email.trim() || !password}>
          <ShieldCheckIcon size={16} />
          <span>Sign In to Student Portal</span>
        </Button>

        <Alert tone="info" title="Haven't claimed your student account yet?">
          First-time students must claim their matric number using the 6-character class code shared by their Class Representative before setting up an email login.
        </Alert>
      </form>

      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <Link to="/" className="link-quiet">
          ← Enter a 6-character class code
        </Link>
        <Link to="/rep/login" className="link-quiet">
          Are you a Class Rep? Sign in →
        </Link>
      </div>
    </div>
  );
}
