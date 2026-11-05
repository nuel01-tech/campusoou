export function SetupRequired() {
  return (
    <main className="container narrow center-page">
      <p className="eyebrow">CampusPulse Setup</p>
      <h1>Connect your Supabase project</h1>
      <p>
        Open <code>.env.local</code> in the project folder and replace the placeholder values with your real{' '}
        <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> from{' '}
        <strong>Supabase Dashboard → Project Settings → API</strong>.
      </p>
      <div className="panel stack" style={{ width: '100%' }}>
        <p className="small muted">Example .env.local:</p>
        <pre className="mono small" style={{ margin: 0, overflowX: 'auto' }}>
          {`VITE_SUPABASE_URL=https://abcdefghijklm.supabase.co\nVITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIs...`}
        </pre>
      </div>
      <p className="muted small">
        After saving <code>.env.local</code>, also make sure you have run{' '}
        <code>supabase/migrations/0001_init.sql</code> in your Supabase SQL Editor, then refresh this page.
      </p>
    </main>
  );
}
