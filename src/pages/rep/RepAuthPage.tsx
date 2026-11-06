import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useAction, useAsync } from '@/hooks/useAsync';
import { useToast } from '@/hooks/useToast';
import { hasSuperAdmin, signInStaff } from '@/services/auth';
import { Alert, Button, ErrorAlert, PageHeader, PageLoader, TextField } from '@/components/ui';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function RepAuthPage() {
  const { ready, role, refreshAuth } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const from = (location.state as { from?: string } | null)?.from;

  const adminExists = useAsync(hasSuperAdmin, []);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [touched, setTouched] = useState(false);

  const action = useAction(async () => signInStaff(email, password, 'rep'));

  if (!ready || adminExists.loading) return <PageLoader />;
  if (role === 'super_admin') return <Navigate to={from ?? '/admin'} replace />;
  if (role === 'rep') return <Navigate to={from ?? '/rep'} replace />;

  const emailError = touched && !EMAIL_RE.test(email.trim()) ? 'Enter a valid email address.' : null;
  const passwordError = touched && password.length < 1 ? 'Enter your password.' : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!EMAIL_RE.test(email.trim()) || password.length < 1) return;
    const profile = await action.run();
    if (profile) {
      await refreshAuth();
      toast(`Welcome, ${profile.full_name}`);
      navigate(profile.role === 'super_admin' ? '/admin' : (from ?? '/rep'), { replace: true });
    }
  };

  return (
    <div className="container narrow stack">
      <PageHeader
        eyebrow="Class Representative Portal"
        title="Class Rep Sign In"
        subtitle="Sign in with the email and password provided to you by the Super Admin."
        back={{ to: '/', label: 'CampusPulse home' }}
      />

      <ErrorAlert error={adminExists.error} onRetry={() => adminExists.reload()} />

      {adminExists.data === false && (
        <Alert
          tone="warning"
          title="System setup not completed yet"
          action={
            <Link to="/admin/setup" className="btn btn-secondary btn-sm">
              <span>Set up Super Admin</span>
            </Link>
          }
        >
          No Super Admin account exists yet. The Super Admin must set up their master account first before creating
          Class Rep accounts.
        </Alert>
      )}

      {role === 'student' && (
        <Alert tone="warning">
          This phone is currently linked to a student. Signing in as a Class Rep here will unlink it. Use a different
          browser or device if needed.
        </Alert>
      )}

      <form onSubmit={submit} noValidate className="panel stack">
        <h2>Sign in to your classes</h2>
        <TextField
          label="Email address"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="rep@university.edu"
          autoComplete="email"
          error={emailError}
          autoFocus
        />
        <TextField
          label="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          error={passwordError}
        />
        <ErrorAlert error={action.error} />
        <Button type="submit" size="lg" block loading={action.pending}>
          Sign in as Class Rep
        </Button>
        <p className="fine-print center">
          Don't have a Class Rep account? Class Reps cannot self-register — contact your Super Admin to get your login
          details.
        </p>
      </form>

      <div className="auth-switch-box">
        <p className="muted small">
          Are you the Super Admin? <Link to="/admin/login">Open Super Admin Portal →</Link>
        </p>
      </div>
    </div>
  );
}
