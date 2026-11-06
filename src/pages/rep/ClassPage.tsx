import { Link, NavLink, Navigate, useParams } from 'react-router-dom';
import { useAsync } from '@/hooks/useAsync';
import { getClass } from '@/services/classes';
import { ErrorAlert, PageHeader, PageLoader } from '@/components/ui';
import { ShareClass } from '@/features/classes/ShareClass';
import { SessionsTab } from '@/features/sessions/SessionsTab';
import { RosterTab } from '@/features/roster/RosterTab';
import { ExportTab } from '@/features/export/ExportTab';
import { SettingsTab } from '@/features/classes/SettingsTab';
import type { ClassRoom } from '@/types';

const TABS = [
  { key: 'sessions', label: 'Sessions' },
  { key: 'students', label: 'Students' },
  { key: 'export', label: 'Export' },
  { key: 'settings', label: 'Settings' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

export default function ClassPage() {
  const { classId = '', tab = 'sessions' } = useParams();
  const klass = useAsync(() => getClass(classId), [classId]);

  if (!TABS.some((t) => t.key === tab)) return <Navigate to={`/rep/class/${classId}`} replace />;
  if (klass.loading) return <PageLoader />;
  if (klass.error || !klass.data) {
    return (
      <div className="container">
        <ErrorAlert error={klass.error} onRetry={() => klass.reload()} />
        <Link to="/rep">← All classes</Link>
      </div>
    );
  }

  const c = klass.data;
  const onUpdated = (updated: ClassRoom) => klass.setData(updated);
  const meta = [c.department_name, c.level].filter(Boolean).join(' · ');

  return (
    <div className="container">
      <PageHeader
        title={c.name}
        subtitle={meta || undefined}
        back={{ to: '/rep', label: 'All classes' }}
      />
      <ShareClass code={c.join_code} />

      <nav className="tabs" aria-label="Class sections">
        {TABS.map((t) => (
          <NavLink
            key={t.key}
            to={t.key === 'sessions' ? `/rep/class/${c.id}` : `/rep/class/${c.id}/${t.key}`}
            end
            className={({ isActive }) => `tab ${isActive ? 'is-active' : ''}`}
          >
            {t.label}
          </NavLink>
        ))}
      </nav>

      <TabContent tab={tab as TabKey} klass={c} onUpdated={onUpdated} />
    </div>
  );
}

function TabContent({ tab, klass, onUpdated }: { tab: TabKey; klass: ClassRoom; onUpdated: (c: ClassRoom) => void }) {
  switch (tab) {
    case 'sessions':
      return <SessionsTab klass={klass} />;
    case 'students':
      return <RosterTab classId={klass.id} />;
    case 'export':
      return <ExportTab klass={klass} />;
    case 'settings':
      return <SettingsTab klass={klass} onUpdated={onUpdated} />;
  }
}
