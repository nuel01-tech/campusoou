import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useAction, useAsync } from '@/hooks/useAsync';
import { useToast } from '@/hooks/useToast';
import { bootstrapSuperAdmin, hasSuperAdmin, signInStaff } from '@/services/auth';
import { Alert, Button, ErrorAlert, PageHeader, PageLoader, TextField } from '@/components/ui';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function AdminAuthPage({ initialTab = 'signin' }: { initialTab?: 'signin' | 'setup' }) {
  const { ready, role, refreshAuth } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const from = (location.state as { from?: string } | null)?.from ?? '/admin';

  const adminExists = useAsync(hasSuperAdmin, []);
  const [tab, setTab] = useState<'signin' | 'setup'>(initialTab);

  // Automatically switch to 'setup' tab if the DB reports no Super Admin exists yet.
  useEffect(() => {
    if (adminExists.data === false) {
      setTab('setup');
    } else if (adminExists.data === true && initialTab !== 'setup') {
      setTab('signin');
    }
  }, [adminExists.data, initialTab]);

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [touched, setTouched] = useState(false);

  const isSetup = tab === 'setup';

  const action = useAction(async () => {
    if (isSetup) {
      return bootstrapSuperAdmin(fullName, email, password);
    }
    return signInStaff(email, password);
  });

  if (!ready || adminExists.loading) return <PageLoader />;
  if (role === 'super_admin') return <Navigate to={from} replace />;
  if (role === 'rep') return <Navigate to="/rep" replace />;

  const nameError = isSetup && touched && fullName.trim().length < 2 ? 'Enter your full name.' : null;
  const emailError = touched && !EMAIL_RE.test(email.trim()) ? 'Enter a valid email address.' : null;
  const passwordError =
    touched && password.length < (isSetup ? 8 : 1)
      ? isSetup
        ? 'Use at least 8 characters.'
        : 'Enter your password.'
      : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (isSetup && fullName.trim().length < 2) return;
    if (!EMAIL_RE.test(email.trim()) || password.length < (isSetup ? 8 : 1)) return;

    const profile = await action.run();
    if (profile) {
      await refreshAuth();
      toast(isSetup ? 'Super Admin account created' : `Welcome back, ${profile.full_name}`);
      navigate(profile.role === 'super_admin' ? '/admin' : '/rep', { replace: true });
    }
  };

  return (
    <div className="container narrow">
      <PageHeader
        title="Super Admin Portal"
        subtitle="Manage department Class Representatives and system access."
        back={{ to: '/', label: 'CampusPulse home' }}
      />

      <div className="segmented auth-tabs" role="tablist" aria-label="Super Admin authentication mode">
        <button
          type="button"
          role="tab"
          aria-selected={!isSetup}
          className={!isSetup ? 'is-active' : ''}
          onClick={() => {
            setTab('signin');
            action.clearError();
          }}
        >
          Sign in
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={isSetup}
          className={isSetup ? 'is-active' : ''}
          onClick={() => {
            setTab('setup');
            action.clearError();
          }}
        >
          First-time setup (Sign up)
        </button>
      </div>

      <ErrorAlert error={adminExists.error} onRetry={() => adminExists.reload()} />

      {isSetup && adminExists.data === false && (
        <Alert tone="info" title="No Super Admin account exists yet">
          Create the master Super Admin account below. Once created, public sign-ups are locked and only you will be
          able to create Class Rep accounts.
        </Alert>
      )}

      {isSetup && adminExists.data === true && (
        <Alert tone="warning" title="Super Admin is already set up">
          A Super Admin account has already been created for this database. Switch to the <strong>Sign in</strong> tab
          above to log in.
        </Alert>
      )}

      {!isSetup && adminExists.data === false && (
        <Alert
          tone="warning"
          title="Have you created your Super Admin account yet?"
          action={
            <Button size="sm" variant="secondary" type="button" onClick={() => setTab('setup')}>
              Create Super Admin
            </Button>
          }
        >
          No Super Admin account was found in the database. Use <strong>First-time setup</strong> first before signing
          in.
        </Alert>
      )}

      <form onSubmit={submit} noValidate className="panel stack">
        <h2>{isSetup ? 'Create Super Admin Account' : 'Sign in as Super Admin'}</h2>

        {isSetup && (
          <TextField
            label="Your full name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="e.g. Nuel (System Administrator)"
            autoComplete="name"
            error={nameError}
            autoFocus
          />
        )}

        <TextField
          label="Email address"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="admin@university.edu"
          autoComplete="email"
          error={emailError}
          autoFocus={!isSetup}
        />

        <TextField
          label="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={isSetup ? 'new-password' : 'current-password'}
          hint={isSetup ? 'At least 8 characters.' : undefined}
          error={passwordError}
        />

        <ErrorAlert error={action.error} />

        <Button type="submit" size="lg" block loading={action.pending}>
          {isSetup ? 'Create Super Admin Account' : 'Sign in to Admin Dashboard'}
        </Button>
      </form>

      <div className="auth-switch-box">
        <p className="muted small">
          Are you a department Class Representative? <Link to="/rep/login">Go to Class Rep Sign In →</Link>
        </p>
      </div>
    </div>
  );
}
