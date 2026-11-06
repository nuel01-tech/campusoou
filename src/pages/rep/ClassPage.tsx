import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { useAsync } from '@/hooks/useAsync';
import { getClass } from '@/services/classes';
import { Badge, ErrorAlert, PageHeader, PageLoader } from '@/components/ui';
import { VerticalTabs, type VerticalTabItem } from '@/components/saas';
import {
  AwardIcon,
  ClipboardCheckIcon,
  FileSpreadsheetIcon,
  PlusIcon,
  SettingsIcon,
  UsersIcon,
} from '@/components/icons';
import { ShareClass } from '@/features/classes/ShareClass';
import { SessionsTab } from '@/features/sessions/SessionsTab';
import { RosterTab } from '@/features/roster/RosterTab';
import { AnalyticsTab } from '@/features/analytics/AnalyticsTab';
import { ExportTab } from '@/features/export/ExportTab';
import { SettingsTab } from '@/features/classes/SettingsTab';
import type { ClassRoom } from '@/types';

const TABS = [
  {
    key: 'sessions',
    label: 'Lecture Sessions',
    description: 'Start & monitor GPS roll-call',
    icon: <ClipboardCheckIcon size={16} />,
  },
  {
    key: 'students',
    label: 'Student Roster',
    description: 'Import list & manage phone claims',
    icon: <UsersIcon size={16} />,
  },
  {
    key: 'analytics',
    label: '75% Eligibility & Stats',
    description: 'Attendance % & at-risk students',
    icon: <AwardIcon size={16} />,
  },
  {
    key: 'export',
    label: 'Export Sheet',
    description: 'Download Excel / CSV matrix',
    icon: <FileSpreadsheetIcon size={16} />,
  },
  {
    key: 'settings',
    label: 'Class Settings',
    description: 'Department, level & danger zone',
    icon: <SettingsIcon size={16} />,
  },
] as const;

type TabKey = (typeof TABS)[number]['key'];

export default function ClassPage() {
  const { classId = '', tab = 'sessions' } = useParams();
  const navigate = useNavigate();
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
  const activeKey = tab as TabKey;

  const vtabItems: VerticalTabItem<TabKey>[] = TABS.map((t) => ({
    key: t.key,
    label: t.label,
    description: t.description,
    icon: t.icon,
  }));

  const handleSelectTab = (key: TabKey) => {
    navigate(key === 'sessions' ? `/rep/class/${c.id}` : `/rep/class/${c.id}/${key}`);
  };

  return (
    <div className="container stack-lg">
      <PageHeader
        eyebrow={c.department_name ? `${c.department_name} · Cohort Workspace` : 'Cohort Workspace'}
        title={c.name}
        subtitle={
          <span className="row" style={{ marginTop: '0.25rem', gap: '0.45rem' }}>
            {c.department_name && <Badge tone="neutral">{c.department_name}</Badge>}
            {c.level && <Badge tone="ok">{c.level}</Badge>}
            <span className="mono muted small">Join Code: {c.join_code}</span>
          </span>
        }
        back={{ to: '/rep', label: 'All classes' }}
        actions={
          <Link to={`/rep/class/${c.id}/new-session`} className="btn btn-primary btn-md">
            <PlusIcon size={15} />
            <span>Start GPS Session</span>
          </Link>
        }
      />

      <ShareClass code={c.join_code} classNameLabel={c.name} />

      <div className="vtabs-layout">
        <aside className="vtabs-rail">
          <VerticalTabs
            items={vtabItems}
            activeKey={activeKey}
            onSelect={handleSelectTab}
            ariaLabel="Class sections"
          />
        </aside>

        <div className="vtabs-panel">
          <TabContent tab={activeKey} klass={c} onUpdated={onUpdated} />
        </div>
      </div>
    </div>
  );
}

function TabContent({
  tab,
  klass,
  onUpdated,
}: {
  tab: TabKey;
  klass: ClassRoom;
  onUpdated: (c: ClassRoom) => void;
}) {
  switch (tab) {
    case 'sessions':
      return <SessionsTab klass={klass} />;
    case 'students':
      return <RosterTab classId={klass.id} />;
    case 'analytics':
      return <AnalyticsTab klass={klass} />;
    case 'export':
      return <ExportTab klass={klass} />;
    case 'settings':
      return <SettingsTab klass={klass} onUpdated={onUpdated} />;
  }
}
