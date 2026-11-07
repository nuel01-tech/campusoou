import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { signInStudent } from '@/services/auth';
import { toAppError } from '@/lib/errors';
import { Alert, Button, ErrorAlert, PageHeader, PageLoader, TextField } from '@/components/ui';

export function StudentLoginPage() {
  const { ready, role } = useAuth();
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
        eyebrow="Student Portal"
        title="Sign in to Campus OOU"
        subtitle="Use the email address and password you saved after claiming your student account."
        back={{ to: '/', label: 'Campus OOU home' }}
      />
      <form onSubmit={submit} className="panel stack">
        <TextField
          label="Email address"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="email"
          required
        />
        <TextField
          label="Password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          required
        />
        <ErrorAlert error={error} />
        <Button type="submit" size="lg" block loading={busy} disabled={!email.trim() || !password}>
          Sign In
        </Button>
        <Alert tone="info" title="Haven't claimed your student account yet?">
          You must claim your matric number with the class code shared by your Class Rep before you can sign in.
        </Alert>
      </form>
      <p className="center small muted">
        <Link to="/" className="link-quiet">Back to the student claim page</Link>
      </p>
    </div>
  );
}
