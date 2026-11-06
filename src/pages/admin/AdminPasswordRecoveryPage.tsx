import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Alert, Button, PageHeader, TextField } from '@/components/ui';

type Mode = 'request' | 'reset';

export default function AdminPasswordRecoveryPage({ mode }: { mode: Mode }) {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [recoveryReady, setRecoveryReady] = useState(false);
  const [checking, setChecking] = useState(mode === 'reset');

  useEffect(() => {
    if (mode !== 'reset') return;
    let active = true;
    const hasRecoveryMarker = () => {
      const query = new URLSearchParams(window.location.search);
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      return query.has('code') || hash.get('type') === 'recovery';
    };

    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (event === 'PASSWORD_RECOVERY' && session) setRecoveryReady(true);
    });

    void supabase.auth.getSession().then(({ data: sessionData, error: sessionError }) => {
      if (!active) return;
      if (sessionError) setError(sessionError.message);
      if (sessionData.session && hasRecoveryMarker()) setRecoveryReady(true);
      setChecking(false);
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [mode]);

  const requestReset = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: `${window.location.origin}/admin/reset-password`,
    });
    setBusy(false);
    if (resetError) setError(resetError.message);
    else
      setMessage(
        'If this email belongs to an account, a password reset link has been sent. Check your inbox and spam folder.',
      );
  };

  const savePassword = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setMessage('');
    if (password.length < 8) {
      setError('Use at least 8 characters for your new password.');
      return;
    }
    if (password !== confirmPassword) {
      setError('The passwords do not match.');
      return;
    }
    setBusy(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    await supabase.auth.signOut();
    setMessage('Your password has been updated. You can now sign in with your new password.');
    setPassword('');
    setConfirmPassword('');
  };

  return (
    <div className="container narrow stack">
      <PageHeader
        eyebrow="Account Recovery"
        title={mode === 'request' ? 'Reset Super Admin Password' : 'Choose a New Password'}
        subtitle={
          mode === 'request'
            ? 'We will email you a secure password-reset link.'
            : 'Set a new password for your existing Super Admin account.'
        }
        back={{ to: '/admin/login', label: 'Back to Super Admin sign in' }}
      />

      {mode === 'request' ? (
        <form onSubmit={requestReset} noValidate className="panel stack">
          <TextField
            label="Super Admin email address"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            required
          />
          {error && <Alert tone="error">{error}</Alert>}
          {message && <Alert tone="success">{message}</Alert>}
          <Button type="submit" size="lg" block loading={busy} disabled={!email.trim()}>
            Send reset link
          </Button>
        </form>
      ) : checking ? (
        <Alert tone="info">Verifying your secure reset link…</Alert>
      ) : !recoveryReady ? (
        <div className="panel stack">
          <Alert tone="warning" title="Reset link not verified">
            Open the newest password-reset email on this device. If the link has expired, request a new one.
          </Alert>
          <Link to="/admin/forgot-password">Request another reset link</Link>
        </div>
      ) : (
        <form onSubmit={savePassword} noValidate className="panel stack">
          <TextField
            label="New password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
            required
          />
          <TextField
            label="Confirm new password"
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            autoComplete="new-password"
            required
          />
          {error && <Alert tone="error">{error}</Alert>}
          {message && <Alert tone="success">{message}</Alert>}
          <Button type="submit" size="lg" block loading={busy} disabled={!password || !confirmPassword}>
            Update password
          </Button>
          {message && (
            <Button
              type="button"
              variant="secondary"
              block
              onClick={() => navigate('/admin/login', { replace: true })}
            >
              Return to sign in
            </Button>
          )}
        </form>
      )}
    </div>
  );
}
