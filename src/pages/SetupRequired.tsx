import { useEffect, useState, type FormEvent } from 'react';
import { isSecretKey, saveRuntimeConfig, tryLoadServerConfig } from '@/lib/supabase';
import { Alert, Button, PageLoader, TextField } from '@/components/ui';

export function SetupRequired({ onConfigured }: { onConfigured?: () => void }) {
  const [checking, setChecking] = useState(true);
  const [url, setUrl] = useState('');
  const [anonKey, setAnonKey] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    tryLoadServerConfig().then((ok) => {
      if (!active) return;
      if (ok) {
        if (onConfigured) onConfigured();
        else window.location.reload();
      } else {
        setChecking(false);
      }
    });
    return () => {
      active = false;
    };
  }, [onConfigured]);

  if (checking) return <PageLoader label="Loading configuration" />;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!/^https:\/\/.+\.supabase\.co/i.test(url.trim())) {
      setError('Enter your Supabase Project URL, e.g. https://abcdefghijklm.supabase.co');
      return;
    }
    if (isSecretKey(anonKey)) {
      setError(
        'That is your Secret key (sb_secret_...). Supabase forbids using secret keys in the browser. Copy the Publishable key (sb_publishable_...) or anon public key instead!',
      );
      return;
    }
    if (anonKey.trim().length < 20) {
      setError('Paste your Supabase Publishable / anon public key (found under Project Settings → API Keys).');
      return;
    }
    const ok = saveRuntimeConfig(url, anonKey);
    if (ok) {
      if (onConfigured) onConfigured();
      else window.location.reload();
    } else {
      setError('Could not validate those keys. Make sure neither value is a placeholder.');
    }
  };

  return (
    <main className="container narrow" style={{ paddingTop: '2.5rem' }}>
      <header className="page-header">
        <p className="eyebrow">CampusPulse Setup</p>
        <h1>Connect your Supabase project</h1>
        <p className="page-subtitle">
          Your environment variables were not detected yet. Paste your Supabase URL and Anon Key below to connect
          immediately, or save them in <code>.env.local</code>.
        </p>
      </header>

      <form onSubmit={submit} noValidate className="panel stack">
        <h2>Enter Supabase Credentials</h2>
        <TextField
          label="Supabase Project URL (VITE_SUPABASE_URL)"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://abcdefghijklm.supabase.co"
          autoComplete="off"
          spellCheck={false}
          autoFocus
        />
        <TextField
          label="Supabase Anon Public Key (VITE_SUPABASE_ANON_KEY)"
          value={anonKey}
          onChange={(e) => setAnonKey(e.target.value)}
          placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
          autoComplete="off"
          spellCheck={false}
          hint="Found in Supabase Dashboard → Project Settings (gear icon) → API."
        />
        {error && <Alert tone="error">{error}</Alert>}
        <Button type="submit" size="lg" block>
          Save & Launch CampusPulse
        </Button>
      </form>

      <div className="section">
        <Alert tone="info" title="Why did this screen appear?">
          <ul className="issue-list small">
            <li>
              <strong>Running locally?</strong> Make sure you saved your keys in{' '}
              <code>c:\Users\NUEL PC\Desktop\attendance marker\.env.local</code> (not inside another folder) and pressed{' '}
              <code>Ctrl+S</code>, then restarted <code>npm run dev</code>.
            </li>
            <li>
              <strong>Deployed on Vercel?</strong> If you added Environment Variables in Vercel Settings <em>after</em>{' '}
              deploying, click <strong>Deployments → Redeploy</strong> so Vercel injects them.
            </li>
          </ul>
        </Alert>
      </div>
    </main>
  );
}
