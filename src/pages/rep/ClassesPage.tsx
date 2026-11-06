import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useAction, useAsync } from '@/hooks/useAsync';
import { createClass, listClasses } from '@/services/classes';
import { listDepartments } from '@/services/admin';
import {
  Badge,
  Button,
  EmptyState,
  ErrorAlert,
  PageHeader,
  PageLoader,
  SelectField,
  TextField,
} from '@/components/ui';
import { KpiStatGrid, VerticalTabs, type VerticalTabItem } from '@/components/saas';
import { formatDate } from '@/lib/format';
import { ACADEMIC_LEVELS, type Department } from '@/types';

type RepWorkspaceTab = 'directory' | 'create' | 'guide';

export default function ClassesPage() {
  const classes = useAsync(listClasses, []);
  const departments = useAsync(listDepartments, []);
  const { profile } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [levelFilter, setLevelFilter] = useState('');

  const list = classes.data ?? [];
  const deptList = departments.data ?? [];

  const rawTab = searchParams.get('tab') as RepWorkspaceTab | null;
  const activeTab: RepWorkspaceTab =
    rawTab && ['directory', 'create', 'guide'].includes(rawTab)
      ? rawTab
      : list.length === 0
        ? 'create'
        : 'directory';

  const setTab = (tab: RepWorkspaceTab) => {
    setSearchParams({ tab });
  };

  const filteredClasses = useMemo(() => {
    const q = search.trim().toLowerCase();
    return list.filter((c) => {
      if (deptFilter && c.department_id !== deptFilter) return false;
      if (levelFilter && c.level !== levelFilter) return false;
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        c.join_code.toLowerCase().includes(q) ||
        (c.department_name ?? '').toLowerCase().includes(q)
      );
    });
  }, [list, search, deptFilter, levelFilter]);

  if (classes.loading) return <PageLoader />;

  const repDeptName = profile?.department_id
    ? deptList.find((d) => d.id === profile.department_id)?.name
    : null;

  const tabItems: VerticalTabItem<RepWorkspaceTab>[] = [
    {
      key: 'directory',
      label: 'All Classes',
      description: 'Browse, filter & manage classes',
      badge: list.length,
    },
    {
      key: 'create',
      label: 'Create New Class',
      description: 'Choose department, level & start date',
      badge: '+',
    },
    {
      key: 'guide',
      label: 'Operations Guide',
      description: 'Roster upload, GPS & 75% rules',
    },
  ];

  return (
    <div className="container stack-lg">
      <PageHeader
        title="Classes Workspace"
        subtitle={
          repDeptName || profile?.level
            ? `Assigned Department: ${[repDeptName, profile?.level].filter(Boolean).join(' · ')}`
            : 'Create classes by department and level, import rosters, and run live GPS attendance sessions.'
        }
        actions={
          activeTab !== 'create' && (
            <Button onClick={() => setTab('create')}>+ New class</Button>
          )
        }
      />

      <KpiStatGrid
        items={[
          {
            label: 'Total Classes',
            value: list.length,
            sublabel: 'Active cohorts in your workspace',
            tone: 'accent',
          },
          {
            label: 'Assigned Department',
            value: repDeptName || 'All Departments',
            sublabel: profile?.full_name || 'Class Representative',
            tone: 'ok',
          },
          {
            label: 'Academic Level',
            value: profile?.level || 'Multi-Level',
            sublabel: 'Default level for new classes',
            tone: 'default',
          },
          {
            label: 'Exam Benchmark',
            value: '75%',
            sublabel: 'Automatic eligibility tracking',
            tone: 'default',
          },
        ]}
      />

      <ErrorAlert error={classes.error} onRetry={() => classes.reload()} />

      <div className="vtabs-layout">
        <aside className="vtabs-rail">
          <VerticalTabs
            items={tabItems}
            activeKey={activeTab}
            onSelect={setTab}
            ariaLabel="Class Rep workspace tabs"
          />
        </aside>

        <div className="vtabs-panel">
          {activeTab === 'directory' && (
            <div className="stack">
              <div className="panel stack">
                <div className="section-head">
                  <div>
                    <h2>Class Directory</h2>
                    <p className="muted small">
                      Select a class to manage sessions, student rosters, 75% eligibility analytics, or Excel exports.
                    </p>
                  </div>
                  <Button size="sm" onClick={() => setTab('create')}>
                    + Create class
                  </Button>
                </div>

                {list.length > 0 && (
                  <div className="filter-bar">
                    <TextField
                      label="Search classes"
                      type="search"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Class name, code, or department…"
                    />
                    <SelectField
                      label="Department"
                      value={deptFilter}
                      onChange={(e) => setDeptFilter(e.target.value)}
                    >
                      <option value="">All departments</option>
                      {deptList.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </SelectField>
                    <SelectField
                      label="Academic level"
                      value={levelFilter}
                      onChange={(e) => setLevelFilter(e.target.value)}
                    >
                      <option value="">All levels</option>
                      {ACADEMIC_LEVELS.map((lvl) => (
                        <option key={lvl} value={lvl}>
                          {lvl}
                        </option>
                      ))}
                    </SelectField>
                  </div>
                )}

                {list.length === 0 ? (
                  <EmptyState
                    title="No classes created yet"
                    action={<Button onClick={() => setTab('create')}>Create your first class</Button>}
                  >
                    Create a class for your department and level (e.g. "Computer Science 300L"), then upload your student list.
                  </EmptyState>
                ) : (
                  <div className="class-cards-grid">
                    {filteredClasses.map((c) => (
                      <div key={c.id} className="class-card">
                        <div className="class-card-head">
                          <div>
                            <Link to={`/rep/class/${c.id}`} className="class-card-title">
                              {c.name}
                            </Link>
                            <div className="row" style={{ marginTop: '0.35rem', gap: '0.4rem' }}>
                              {c.department_name && <Badge tone="neutral">{c.department_name}</Badge>}
                              {c.level && <Badge tone="ok">{c.level}</Badge>}
                            </div>
                          </div>
                          <span className="mono code-chip" title="Student Join Code">
                            {c.join_code}
                          </span>
                        </div>
                        <p className="muted small">Created {formatDate(c.created_at)}</p>
                        <div className="class-card-actions">
                          <Link to={`/rep/class/${c.id}`} className="btn btn-primary btn-sm">
                            <span>Sessions</span>
                          </Link>
                          <Link to={`/rep/class/${c.id}/students`} className="btn btn-secondary btn-sm">
                            <span>Roster</span>
                          </Link>
                          <Link to={`/rep/class/${c.id}/analytics`} className="btn btn-ghost btn-sm">
                            <span>75% Stats</span>
                          </Link>
                          <Link to={`/rep/class/${c.id}/export`} className="btn btn-ghost btn-sm">
                            <span>Export</span>
                          </Link>
                        </div>
                      </div>
                    ))}
                    {filteredClasses.length === 0 && (
                      <p className="muted small">No classes match your filter criteria.</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'create' && (
            <NewClassForm
              departments={deptList}
              defaultDepartmentId={profile?.department_id ?? undefined}
              defaultLevel={profile?.level ?? undefined}
              onCancel={list.length ? () => setTab('directory') : undefined}
            />
          )}

          {activeTab === 'guide' && (
            <div className="panel stack">
              <h2>Class Rep Operations Guide</h2>
              <div className="steps-grid">
                <div className="step-card">
                  <span className="step-num">STEP 1</span>
                  <h3>Create Class & Upload Roster</h3>
                  <p className="muted small">
                    Select your Department and Level, create the class, and upload an Excel (`.xlsx`) or `.csv` file with columns <strong>Name</strong> and <strong>Matric No</strong>.
                  </p>
                </div>
                <div className="step-card">
                  <span className="step-num">STEP 2</span>
                  <h3>Share WhatsApp Join Link</h3>
                  <p className="muted small">
                    Click <strong>WhatsApp group</strong> on the class banner to post the one-time enrollment link. Each student claims their matric number on their own phone.
                  </p>
                </div>
                <div className="step-card">
                  <span className="step-num">STEP 3</span>
                  <h3>Start GPS + Passkey Sessions</h3>
                  <p className="muted small">
                    When in the lecture hall, start a session with the course code, venue, and radius. Students verify within range using their fingerprint or Face ID.
                  </p>
                </div>
                <div className="step-card">
                  <span className="step-num">STEP 4</span>
                  <h3>75% Eligibility & Export</h3>
                  <p className="muted small">
                    Open the <strong>75% Eligibility & Stats</strong> tab to spot at-risk students, or download the vertical weekly matrix in Excel/CSV format for lecturers.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function NewClassForm({
  departments,
  defaultDepartmentId,
  defaultLevel,
  onCancel,
}: {
  departments: Department[];
  defaultDepartmentId?: string;
  defaultLevel?: string;
  onCancel?: () => void;
}) {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [departmentId, setDepartmentId] = useState(
    defaultDepartmentId || (departments[0]?.id ?? ''),
  );
  const [level, setLevel] = useState<string>(defaultLevel || '100L');
  const [start, setStart] = useState('');
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (defaultDepartmentId && !departmentId) {
      setDepartmentId(defaultDepartmentId);
    }
  }, [defaultDepartmentId, departmentId]);

  useEffect(() => {
    if (defaultLevel && !level) {
      setLevel(defaultLevel);
    }
  }, [defaultLevel, level]);

  const create = useAction(() =>
    createClass({
      name,
      department_id: departmentId || null,
      level: level || null,
      semester_start: start || null,
    }),
  );

  const nameError = touched && name.trim().length < 2 ? 'Give the class a name.' : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (name.trim().length < 2) return;
    const created = await create.run();
    if (created) navigate(`/rep/class/${created.id}/students`);
  };

  return (
    <form onSubmit={submit} noValidate className="panel stack">
      <div>
        <h2>Create New Class</h2>
        <p className="muted small">
          Choose the department and academic level for this cohort. After creating, you can upload your Excel/CSV student list.
        </p>
      </div>

      <TextField
        label="Class / Cohort name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="e.g. Computer Science 300L (2026/2027)"
        error={nameError}
        maxLength={120}
        autoFocus
      />

      <div className="grid-2">
        <SelectField
          label="Department"
          value={departmentId}
          onChange={(e) => setDepartmentId(e.target.value)}
          hint={
            departments.length === 0
              ? 'No departments added by Super Admin yet.'
              : 'Choose the department this class belongs to.'
          }
        >
          <option value="">Select department…</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </SelectField>

        <SelectField
          label="Academic level"
          value={level}
          onChange={(e) => setLevel(e.target.value)}
          hint="Select the academic level for this class."
        >
          <option value="">Select level…</option>
          {ACADEMIC_LEVELS.map((lvl) => (
            <option key={lvl} value={lvl}>
              {lvl}
            </option>
          ))}
        </SelectField>
      </div>

      <TextField
        label="Semester start date (optional)"
        type="date"
        value={start}
        onChange={(e) => setStart(e.target.value)}
        hint="Used to automatically calculate the lecture week number (Week 1, Week 2, etc.)."
      />
      <ErrorAlert error={create.error} />
      <div className="row">
        <Button type="submit" loading={create.pending}>
          Create class & continue
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
