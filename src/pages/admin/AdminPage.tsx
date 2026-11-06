import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAction, useAsync, usePolling } from '@/hooks/useAsync';
import { useToast } from '@/hooks/useToast';
import { supabase } from '@/services/db';
import { listLiveCampusSessions, type LiveCampusSession } from '@/services/sessions';
import {
  createDepartment,
  createRepAccount,
  deleteDepartment,
  deleteRep,
  listDepartments,
  listReps,
  setRepActive,
} from '@/services/admin';
import {
  Alert,
  Badge,
  Button,
  ConfirmButton,
  EmptyState,
  ErrorAlert,
  PageHeader,
  PageLoader,
  SelectField,
  StatusPill,
  StudentCell,
  TextField,
} from '@/components/ui';
import { KpiStatGrid, VerticalTabs, type VerticalTabItem } from '@/components/saas';
import {
  AlertCircleIcon,
  Building2Icon,
  ClipboardCheckIcon,
  CopyIcon,
  LayoutDashboardIcon,
  MessageSquareIcon,
  PlusIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
  UserPlusIcon,
  UsersIcon,
} from '@/components/icons';
import { toAppError } from '@/lib/errors';
import { formatDate, formatTime, pluralize } from '@/lib/format';
import { ACADEMIC_LEVELS, type Department, type RepSummary } from '@/types';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type AdminTabKey = 'overview' | 'live-sessions' | 'defaulters' | 'reps' | 'create' | 'departments' | 'audit';

interface CreatedCredentials {
  full_name: string;
  department_name: string;
  level: string;
  email: string;
  password: string;
}

function generatePassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

export default function AdminPage() {
  const reps = useAsync(listReps, []);
  const departments = useAsync(listDepartments, []);
  const liveSessions = useAsync(listLiveCampusSessions, []);
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [created, setCreated] = useState<CreatedCredentials | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selectedDeptId, setSelectedDeptId] = useState<string>('');
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [levelFilter, setLevelFilter] = useState('');

  const rawTab = searchParams.get('tab') as AdminTabKey | null;
  const activeTab: AdminTabKey =
    rawTab && ['overview', 'live-sessions', 'defaulters', 'reps', 'create', 'departments', 'audit'].includes(rawTab)
      ? rawTab
      : 'overview';

  usePolling(() => void liveSessions.reload({ silent: true }), 10_000, activeTab === 'live-sessions');

  const setTab = (tab: AdminTabKey) => {
    setSearchParams({ tab });
  };

  const list = reps.data ?? [];
  const deptList = departments.data ?? [];
  const liveList = liveSessions.data ?? [];

  const filteredReps = useMemo(() => {
    const q = search.trim().toLowerCase();
    return list.filter((r) => {
      if (deptFilter && r.department_id !== deptFilter) return false;
      if (levelFilter && r.level !== levelFilter) return false;
      if (!q) return true;
      return (
        r.full_name.toLowerCase().includes(q) ||
        r.email.toLowerCase().includes(q) ||
        (r.department_name ?? '').toLowerCase().includes(q)
      );
    });
  }, [list, search, deptFilter, levelFilter]);

  if (reps.loading || departments.loading) return <PageLoader />;

  const activeRepsCount = list.filter((r) => r.active).length;
  const totalClassesCount = list.reduce((sum, r) => sum + r.class_count, 0);
  const totalStudentsCount = list.reduce((sum, r) => sum + r.student_count, 0);
  const maxDeptReps = Math.max(1, ...deptList.map((d) => d.rep_count));

  const tabItems: VerticalTabItem<AdminTabKey>[] = [
    {
      key: 'overview',
      label: 'Executive Overview',
      description: 'KPI metrics & department summary',
      icon: <LayoutDashboardIcon size={16} />,
    },
    {
      key: 'live-sessions',
      label: 'Live Campus Sessions',
      description: 'Real-time active lecture roll-calls',
      badge: liveList.length > 0 ? `${liveList.length} Live` : undefined,
      icon: <ClipboardCheckIcon size={16} />,
    },
    {
      key: 'defaulters',
      label: 'Defaulters Watchlist',
      description: 'Students below 75% NUC benchmark',
      icon: <AlertCircleIcon size={16} />,
    },
    {
      key: 'reps',
      label: 'Class Rep Directory',
      description: 'Search, filter & manage reps',
      badge: list.length,
      icon: <UsersIcon size={16} />,
    },
    {
      key: 'create',
      label: 'Provision Class Rep',
      description: 'Assign department, level & login',
      badge: '+',
      icon: <UserPlusIcon size={16} />,
    },
    {
      key: 'departments',
      label: 'Departments Manager',
      description: 'Add or remove departments',
      badge: deptList.length,
      icon: <Building2Icon size={16} />,
    },
    {
      key: 'audit',
      label: 'Anti-Proxy & Device Audit',
      description: 'Biometric passkeys & device bindings',
      icon: <ShieldCheckIcon size={16} />,
    },
  ];

  const handleToggleActive = async (rep: RepSummary) => {
    setBusyId(rep.id);
    try {
      const updated = await setRepActive(rep.id, !rep.active);
      reps.setData((prev) =>
        (prev ?? []).map((r) => (r.id === rep.id ? { ...r, active: updated.active } : r)),
      );
      toast(updated.active ? `${rep.full_name} reactivated` : `${rep.full_name} suspended`);
    } catch (e) {
      toast(toAppError(e).message, 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (rep: RepSummary) => {
    setBusyId(rep.id);
    try {
      await deleteRep(rep.id);
      reps.setData((prev) => (prev ?? []).filter((r) => r.id !== rep.id));
      void departments.reload({ silent: true });
      toast(`Deleted ${rep.full_name}`);
    } catch (e) {
      toast(toAppError(e).message, 'error');
    } finally {
      setBusyId(null);
    }
  };

  const copyCredentials = async (c: CreatedCredentials) => {
    const text = [
      'CampusPulse — Class Rep Login',
      `Department: ${c.department_name}`,
      `Level: ${c.level}`,
      `Link: ${window.location.origin}/rep/login`,
      `Email: ${c.email}`,
      `Password: ${c.password}`,
    ].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      toast('Login details copied to clipboard');
    } catch {
      toast('Could not copy automatically. Copy the details manually.', 'error');
    }
  };

  const shareCredentialsWhatsApp = (c: CreatedCredentials) => {
    const text = [
      '*CampusPulse — Class Rep Account*',
      `Name: ${c.full_name}`,
      `Department: ${c.department_name} (${c.level})`,
      `Sign-in Link: ${window.location.origin}/rep/login`,
      `Email: ${c.email}`,
      `Password: ${c.password}`,
    ].join('\n');
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="container stack-lg">
      <PageHeader
        eyebrow="Olabisi Onabanjo University · Governance Suite"
        title="Super Admin Control Center"
        subtitle="Manage university departments, provision Class Rep accounts by level, and oversee attendance operations."
        actions={
          <div className="row">
            <Button variant="secondary" onClick={() => setTab('departments')}>
              <Building2Icon size={15} />
              <span>Departments</span>
            </Button>
            <Button
              onClick={() => {
                setCreated(null);
                setTab('create');
              }}
            >
              <PlusIcon size={15} />
              <span>New Class Rep</span>
            </Button>
          </div>
        }
      />

      <KpiStatGrid
        items={[
          {
            label: 'Total Class Reps',
            value: list.length,
            sublabel: `${activeRepsCount} active · ${list.length - activeRepsCount} suspended`,
            tone: 'accent',
          },
          {
            label: 'Departments',
            value: deptList.length,
            sublabel: 'Configured university departments',
            tone: 'ok',
          },
          {
            label: 'Active Classes',
            value: totalClassesCount,
            sublabel: 'Managed across all levels',
            tone: 'purple',
          },
          {
            label: 'Enrolled Students',
            value: totalStudentsCount,
            sublabel: 'Total students on class rosters',
            tone: 'warn',
          },
        ]}
      />

      {created && (
        <Alert
          tone="success"
          title={`Created account for ${created.full_name} (${created.department_name} · ${created.level})`}
          action={
            <div className="row">
              <Button size="sm" variant="secondary" onClick={() => copyCredentials(created)}>
                <CopyIcon size={13} />
                <span>Copy details</span>
              </Button>
              <Button size="sm" variant="ghost" onClick={() => shareCredentialsWhatsApp(created)}>
                <MessageSquareIcon size={13} />
                <span>WhatsApp</span>
              </Button>
            </div>
          }
        >
          Send these details to the class rep — they can sign in immediately at{' '}
          <span className="mono">{window.location.origin}/rep/login</span>:<br />
          Department: <strong>{created.department_name}</strong> · Level: <strong>{created.level}</strong> · Email:{' '}
          <strong className="mono">{created.email}</strong> · Password:{' '}
          <strong className="mono">{created.password}</strong>
        </Alert>
      )}

      <div className="vtabs-layout">
        <aside className="vtabs-rail">
          <VerticalTabs
            items={tabItems}
            activeKey={activeTab}
            onSelect={setTab}
            ariaLabel="Super Admin workspace tabs"
          />
        </aside>

        <div className="vtabs-panel">
          {activeTab === 'overview' && (
            <div className="stack-lg">
              {deptList.length > 0 && (
                <section className="panel stack">
                  <div className="section-head">
                    <div>
                      <h2>Department Representation Distribution</h2>
                      <p className="muted small">
                        Assigned Class Representatives across configured university departments.
                      </p>
                    </div>
                    <Badge tone="ok">{deptList.length} Departments</Badge>
                  </div>

                  <div className="chart-bars" aria-label="Department representation chart">
                    {deptList.slice(0, 8).map((d, idx) => {
                      const pct = Math.max(16, Math.round((d.rep_count / maxDeptReps) * 100));
                      return (
                        <div key={d.id} className="chart-col">
                          <div className="chart-bar-wrap">
                            <div
                              className={`chart-bar ${idx === 0 || d.rep_count === maxDeptReps ? 'is-highlight' : ''}`}
                              style={{ height: `${pct}%` }}
                            >
                              <span>{d.rep_count}</span>
                            </div>
                          </div>
                          <span className="chart-label" title={d.name}>
                            {d.name.slice(0, 10)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}

              <section className="panel stack">
                <div className="section-head">
                  <div>
                    <h2>Department Coverage Matrix</h2>
                    <p className="muted small">
                      Breakdown of departments and assigned Class Representatives across levels.
                    </p>
                  </div>
                  <Button size="sm" variant="secondary" onClick={() => setTab('departments')}>
                    Manage departments
                  </Button>
                </div>

                {deptList.length === 0 ? (
                  <EmptyState
                    title="No departments created yet"
                    action={<Button onClick={() => setTab('departments')}>Create first department</Button>}
                  >
                    Start by adding your university departments (e.g. Computer Science, Microbiology, Economics) so you can assign Class Reps to them.
                  </EmptyState>
                ) : (
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Department Name</th>
                          <th className="num">Assigned Reps</th>
                          <th>Created</th>
                          <th className="actions-col">Quick Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {deptList.map((d) => (
                          <tr key={d.id}>
                            <td>
                              <strong>{d.name}</strong>
                            </td>
                            <td className="num">
                              <Badge tone={d.rep_count > 0 ? 'ok' : 'muted'}>
                                {pluralize(d.rep_count, 'rep', 'reps')}
                              </Badge>
                            </td>
                            <td className="muted nowrap">{formatDate(d.created_at)}</td>
                            <td className="actions-col">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  setSelectedDeptId(d.id);
                                  setTab('create');
                                }}
                              >
                                <PlusIcon size={13} />
                                <span>Add rep here</span>
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <section className="panel stack">
                <div className="section-head">
                  <div>
                    <h2>Recent Class Rep Accounts</h2>
                    <p className="muted small">Latest provisioned Class Representatives.</p>
                  </div>
                  <div className="row">
                    <Link to="/rep" className="btn btn-ghost btn-sm">
                      <span>Open Classes Workspace →</span>
                    </Link>
                    <Button size="sm" variant="secondary" onClick={() => setTab('reps')}>
                      View all ({list.length})
                    </Button>
                  </div>
                </div>

                {list.length === 0 ? (
                  <p className="muted small">No Class Reps provisioned yet.</p>
                ) : (
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Class Representative</th>
                          <th>Department</th>
                          <th>Level</th>
                          <th>Status</th>
                          <th className="num">Classes</th>
                          <th className="num">Students</th>
                        </tr>
                      </thead>
                      <tbody>
                        {list.slice(0, 5).map((r) => (
                          <tr key={r.id}>
                            <td>
                              <StudentCell name={r.full_name} subtext={r.email} />
                            </td>
                            <td>
                              {r.department_name ? (
                                <Badge tone="neutral">{r.department_name}</Badge>
                              ) : (
                                <span className="muted small">Unassigned</span>
                              )}
                            </td>
                            <td>{r.level ? <Badge tone="ok">{r.level}</Badge> : '—'}</td>
                            <td>
                              <StatusPill
                                status={r.active ? 'present' : 'absent'}
                                label={r.active ? 'Active' : 'Suspended'}
                              />
                            </td>
                            <td className="num mono">{r.class_count}</td>
                            <td className="num mono">{r.student_count}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>
          )}

          {activeTab === 'reps' && (
            <section className="panel stack">
              <div className="section-head">
                <div>
                  <h2>Class Rep Directory</h2>
                  <p className="muted small">
                    Filter by department or level, suspend access, or remove accounts.
                  </p>
                </div>
                <Button size="sm" onClick={() => setTab('create')}>
                  <PlusIcon size={14} />
                  <span>Provision rep</span>
                </Button>
              </div>

              <ErrorAlert error={reps.error} onRetry={() => reps.reload()} />

              <div className="filter-bar">
                <TextField
                  label="Search rep"
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Name, email, or department…"
                />
                <SelectField
                  label="Filter by Department"
                  value={deptFilter}
                  onChange={(e) => setDeptFilter(e.target.value)}
                >
                  <option value="">All departments ({deptList.length})</option>
                  {deptList.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </SelectField>
                <SelectField
                  label="Filter by Level"
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

              {list.length === 0 && !reps.error ? (
                <EmptyState
                  title="No class reps yet"
                  action={<Button onClick={() => setTab('create')}>Create first Class Rep</Button>}
                >
                  Provision an account for each department and level's Class Representative.
                </EmptyState>
              ) : (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Class Representative</th>
                        <th>Department</th>
                        <th>Level</th>
                        <th className="num">Classes</th>
                        <th className="num">Students</th>
                        <th>Status</th>
                        <th>Created</th>
                        <th className="actions-col">
                          <span className="sr-only">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredReps.map((r) => {
                        const busy = busyId === r.id;
                        return (
                          <tr key={r.id}>
                            <td>
                              <StudentCell name={r.full_name} subtext={r.email} />
                            </td>
                            <td>
                              {r.department_name ? (
                                <Badge tone="neutral">{r.department_name}</Badge>
                              ) : (
                                <span className="muted small">Unassigned</span>
                              )}
                            </td>
                            <td>
                              {r.level ? (
                                <Badge tone="ok">{r.level}</Badge>
                              ) : (
                                <span className="muted small">—</span>
                              )}
                            </td>
                            <td className="num mono">{r.class_count}</td>
                            <td className="num mono">{r.student_count}</td>
                            <td>
                              <StatusPill
                                status={r.active ? 'present' : 'absent'}
                                label={r.active ? 'Active' : 'Suspended'}
                              />
                            </td>
                            <td className="nowrap muted">{formatDate(r.created_at)}</td>
                            <td className="actions-col">
                              <Button
                                size="sm"
                                variant="ghost"
                                loading={busy}
                                onClick={() => handleToggleActive(r)}
                              >
                                {r.active ? 'Suspend' : 'Activate'}
                              </Button>
                              <ConfirmButton
                                size="sm"
                                loading={busy}
                                onConfirm={() => handleDelete(r)}
                                confirmText={`Delete ${pluralize(r.class_count, 'class', 'classes')}?`}
                              >
                                Delete
                              </ConfirmButton>
                            </td>
                          </tr>
                        );
                      })}
                      {filteredReps.length === 0 && (
                        <tr>
                          <td colSpan={8} className="muted center">
                            No Class Reps match your current filters.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {activeTab === 'create' && (
            <NewRepForm
              departments={deptList}
              defaultDepartmentId={selectedDeptId}
              onOpenDepartments={() => setTab('departments')}
              onCancel={() => setTab('reps')}
              onCreated={(creds) => {
                setCreated(creds);
                toast(`Created class rep ${creds.full_name} (${creds.level})`);
                void reps.reload({ silent: true });
                void departments.reload({ silent: true });
                setTab('reps');
              }}
            />
          )}

          {activeTab === 'live-sessions' && (
            <AdminLiveSessionsPanel
              sessions={liveList}
              loading={liveSessions.loading}
              onRefresh={() => void liveSessions.reload()}
            />
          )}

          {activeTab === 'defaulters' && (
            <AdminDefaultersPanel departments={deptList} />
          )}

          {activeTab === 'audit' && (
            <AdminAuditPanel />
          )}

          {activeTab === 'departments' && (
            <DepartmentsPanel
              departments={deptList}
              error={departments.error}
              onRetry={() => departments.reload()}
              onCreated={(dept) => {
                departments.setData((prev) =>
                  [...(prev ?? []), dept].sort((a, b) => a.name.localeCompare(b.name)),
                );
                setSelectedDeptId(dept.id);
                toast(`Added ${dept.name} department`);
              }}
              onDeleted={(dept) => {
                departments.setData((prev) => (prev ?? []).filter((d) => d.id !== dept.id));
                if (selectedDeptId === dept.id) setSelectedDeptId('');
                void reps.reload({ silent: true });
                toast(`Removed ${dept.name} department`);
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function DepartmentsPanel({
  departments,
  error,
  onRetry,
  onCreated,
  onDeleted,
}: {
  departments: Department[];
  error: ReturnType<typeof toAppError> | null;
  onRetry: () => void;
  onCreated: (dept: Department) => void;
  onDeleted: (dept: Department) => void;
}) {
  const [name, setName] = useState('');
  const [touched, setTouched] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const toast = useToast();

  const create = useAction(async () => createDepartment(name.trim()));

  const nameError =
    touched && name.trim().length < 2 ? 'Enter a department name (at least 2 characters).' : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (name.trim().length < 2) return;
    const dept = await create.run();
    if (dept) {
      setName('');
      setTouched(false);
      onCreated(dept);
    }
  };

  const handleDelete = async (dept: Department) => {
    setDeletingId(dept.id);
    try {
      await deleteDepartment(dept.id);
      onDeleted(dept);
    } catch (e) {
      toast(toAppError(e).message, 'error');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <section className="panel stack">
      <div className="section-head">
        <div>
          <h2>Departments Manager</h2>
          <p className="muted small">
            Add departments here so you can select them when creating Class Rep accounts or classes.
          </p>
        </div>
        <Badge tone="neutral">{pluralize(departments.length, 'department', 'departments')}</Badge>
      </div>

      <form onSubmit={submit} noValidate className="dept-form-row">
        <TextField
          label="New department name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Computer Science, Microbiology, Economics"
          error={nameError}
          maxLength={120}
          autoFocus
        />
        <Button type="submit" variant="primary" loading={create.pending}>
          <PlusIcon size={15} />
          <span>Add department</span>
        </Button>
      </form>

      <ErrorAlert error={create.error ?? error} onRetry={error ? onRetry : undefined} />

      {departments.length === 0 ? (
        <EmptyState title="No departments created yet">
          Add your first department above (e.g. Computer Science) before creating a Class Rep.
        </EmptyState>
      ) : (
        <ul className="dept-chips" aria-label="Departments">
          {departments.map((d) => (
            <li key={d.id} className="dept-chip">
              <span className="dept-chip-name">{d.name}</span>
              <span className="dept-chip-count">{pluralize(d.rep_count, 'rep', 'reps')}</span>
              <ConfirmButton
                size="sm"
                loading={deletingId === d.id}
                onConfirm={() => handleDelete(d)}
                confirmText="Remove?"
              >
                ×
              </ConfirmButton>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function NewRepForm({
  departments,
  defaultDepartmentId,
  onOpenDepartments,
  onCancel,
  onCreated,
}: {
  departments: Department[];
  defaultDepartmentId?: string;
  onOpenDepartments: () => void;
  onCancel?: () => void;
  onCreated: (creds: CreatedCredentials) => void;
}) {
  const [fullName, setFullName] = useState('');
  const [departmentId, setDepartmentId] = useState(
    defaultDepartmentId || (departments[0]?.id ?? ''),
  );
  const [level, setLevel] = useState<string>('100L');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState(() => generatePassword());
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (defaultDepartmentId) {
      setDepartmentId(defaultDepartmentId);
    } else if (!departmentId && departments.length > 0) {
      setDepartmentId(departments[0]!.id);
    }
  }, [defaultDepartmentId, departments, departmentId]);

  const selectedDept = departments.find((d) => d.id === departmentId) ?? null;

  const create = useAction(async () => {
    const clean = {
      full_name: fullName.trim(),
      department_id: departmentId || null,
      department_name: selectedDept?.name ?? 'Unassigned',
      level: level.trim(),
      email: email.trim().toLowerCase(),
      password,
    };
    await createRepAccount({
      full_name: clean.full_name,
      email: clean.email,
      password: clean.password,
      department_id: clean.department_id,
      level: clean.level,
    });
    return clean;
  });

  const nameError =
    touched && fullName.trim().length < 2 ? 'Enter the class rep’s full name.' : null;
  const deptError =
    touched && !departmentId
      ? departments.length === 0
        ? 'Create a department in the Departments tab first.'
        : 'Choose a department for this class rep.'
      : null;
  const levelError = touched && !level ? 'Select a level for this class rep.' : null;
  const emailError =
    touched && !EMAIL_RE.test(email.trim()) ? 'Enter a valid email address.' : null;
  const passwordError =
    touched && password.length < 8 ? 'Password must be at least 8 characters.' : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (
      fullName.trim().length < 2 ||
      !departmentId ||
      !level ||
      !EMAIL_RE.test(email.trim()) ||
      password.length < 8
    ) {
      return;
    }
    const creds = await create.run();
    if (creds) onCreated(creds);
  };

  return (
    <form onSubmit={submit} noValidate className="panel stack">
      <div className="section-head">
        <div>
          <h2>Provision Class Rep Account</h2>
          <p className="muted small">
            Assign the Class Rep to a department and academic level. Their account is confirmed immediately.
          </p>
        </div>
        {departments.length === 0 && (
          <Button type="button" size="sm" variant="secondary" onClick={onOpenDepartments}>
            + Add Department First
          </Button>
        )}
      </div>

      <TextField
        label="Class rep full name"
        value={fullName}
        onChange={(e) => setFullName(e.target.value)}
        placeholder="e.g. Chinedu Okafor"
        error={nameError}
        autoFocus
      />

      <div className="grid-2">
        <SelectField
          label="Department"
          value={departmentId}
          onChange={(e) => setDepartmentId(e.target.value)}
          error={deptError}
          disabled={departments.length === 0}
          hint={
            departments.length === 0
              ? 'Open the Departments tab to add a department first.'
              : 'Select the department this class rep belongs to.'
          }
        >
          <option value="">
            {departments.length === 0 ? 'No departments created yet…' : 'Select a department…'}
          </option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </SelectField>

        <SelectField
          label="Academic Level"
          value={level}
          onChange={(e) => setLevel(e.target.value)}
          error={levelError}
          hint="Select the academic level (e.g. 100L, 200L)."
        >
          <option value="">Select a level…</option>
          {ACADEMIC_LEVELS.map((lvl) => (
            <option key={lvl} value={lvl}>
              {lvl}
            </option>
          ))}
        </SelectField>
      </div>

      <div className="grid-2">
        <TextField
          label="Email address"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="rep@university.edu"
          autoComplete="off"
          error={emailError}
        />
        <div className="password-row">
          <TextField
            label="Initial password"
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mono-input"
            hint="Share with the class rep — no email confirmation required."
            error={passwordError}
          />
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={() => setPassword(generatePassword())}
          >
            Generate
          </Button>
        </div>
      </div>

      <ErrorAlert error={create.error} />

      <div className="row">
        <Button type="submit" loading={create.pending}>
          Create class rep account
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

function AdminLiveSessionsPanel({
  sessions,
  loading,
  onRefresh,
}: {
  sessions: LiveCampusSession[];
  loading: boolean;
  onRefresh: () => void;
}) {
  return (
    <section className="panel stack">
      <div className="section-head">
        <div>
          <h2>Campus Live Sessions Monitor</h2>
          <p className="muted small">
            Real-time feed of all ongoing lecture roll-calls across university departments.
          </p>
        </div>
        <div className="row">
          <Button size="sm" variant="secondary" onClick={onRefresh} loading={loading}>
            <RefreshCwIcon size={13} />
            <span>Refresh</span>
          </Button>
          <Link to="/rep" className="btn btn-primary btn-sm">
            <PlusIcon size={14} />
            <span>Start a session</span>
          </Link>
        </div>
      </div>

      {sessions.length === 0 ? (
        <EmptyState
          title="No live sessions running right now"
          action={
            <Link to="/rep" className="btn btn-secondary btn-sm">
              <span>View all classes</span>
            </Link>
          }
        >
          When Class Representatives start a GPS attendance session for their cohort, it will appear here in real time.
        </EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Course</th>
                <th>Class Cohort</th>
                <th>Department & Level</th>
                <th>Venue</th>
                <th className="num">Present</th>
                <th>Started</th>
                <th className="actions-col">Action</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id}>
                  <td>
                    <strong>{s.course_code}</strong>
                  </td>
                  <td>{s.class_name}</td>
                  <td>
                    <div className="row" style={{ gap: '0.35rem' }}>
                      {s.department_name && <Badge tone="neutral">{s.department_name}</Badge>}
                      {s.level && <Badge tone="ok">{s.level}</Badge>}
                    </div>
                  </td>
                  <td>
                    {s.venue} ({s.radius_m}m)
                  </td>
                  <td className="num">
                    <Badge tone="live">{s.present_count} Present</Badge>
                  </td>
                  <td className="nowrap muted">{formatTime(s.starts_at)}</td>
                  <td className="actions-col">
                    <Link to={`/rep/session/${s.id}`} className="btn btn-secondary btn-sm">
                      <span>Open live roll-call →</span>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function AdminDefaultersPanel({ departments }: { departments: Department[] }) {
  const [query, setQuery] = useState('');
  const [deptFilter, setDeptFilter] = useState('');

  const defaultersQuery = useAsync(async () => {
    const { data: students } = await supabase
      .from('students')
      .select('id, full_name, matric_no, class_id, classes(id, name, level, department_id, departments(name))')
      .order('full_name');

    if (!students || students.length === 0) return [];

    const { data: attendanceRows } = await supabase
      .from('attendance')
      .select('student_id, session_id');

    const counts = new Map<string, number>();
    for (const a of attendanceRows ?? []) {
      counts.set(a.student_id, (counts.get(a.student_id) ?? 0) + 1);
    }

    return students.map((st: any) => {
      const attended = counts.get(st.id) ?? 0;
      return {
        id: st.id,
        full_name: st.full_name,
        matric_no: st.matric_no,
        class_name: st.classes?.name ?? 'Class',
        department_name: st.classes?.departments?.name ?? 'General',
        department_id: st.classes?.department_id,
        level: st.classes?.level,
        attended,
      };
    });
  }, []);

  const list = defaultersQuery.data ?? [];
  const filtered = list.filter((st) => {
    if (deptFilter && st.department_id !== deptFilter) return false;
    if (!query) return true;
    const q = query.toLowerCase();
    return st.full_name.toLowerCase().includes(q) || st.matric_no.toLowerCase().includes(q);
  });

  const shareWhatsAppWarning = (st: (typeof list)[0]) => {
    const text = [
      `*OFFICIAL UNIVERSITY ATTENDANCE WARNING*`,
      `Student: ${st.full_name} (${st.matric_no})`,
      `Class: ${st.class_name} · ${st.department_name}`,
      `Total Sessions Attended: ${st.attended}`,
      `\n*Notice:* Your attendance record is currently below the mandatory 75% NUC exam eligibility threshold. You risk being debarred from sitting semester examinations. Please report to your Class Representative immediately.`,
    ].join('\n');
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
  };

  return (
    <section className="panel stack">
      <div className="section-head">
        <div>
          <h2>University Defaulters & Exam Eligibility Watchlist</h2>
          <p className="muted small">
            Identify students at risk of disqualification under the 75% NUC attendance rule.
          </p>
        </div>
      </div>

      <div className="filter-bar">
        <TextField
          label="Search student"
          placeholder="Name or matric number…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <SelectField
          label="Department"
          value={deptFilter}
          onChange={(e) => setDeptFilter(e.target.value)}
        >
          <option value="">All departments</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </SelectField>
      </div>

      {defaultersQuery.loading ? (
        <PageLoader />
      ) : filtered.length === 0 ? (
        <p className="muted small">No students found.</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Student</th>
                <th>Matric No</th>
                <th>Class Cohort</th>
                <th>Department</th>
                <th className="num">Attended</th>
                <th>Status</th>
                <th className="actions-col">Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 100).map((st) => (
                <tr key={st.id}>
                  <td>
                    <StudentCell name={st.full_name} />
                  </td>
                  <td className="mono">{st.matric_no}</td>
                  <td>{st.class_name}</td>
                  <td>{st.department_name}</td>
                  <td className="num mono">{st.attended}</td>
                  <td>
                    <StatusPill
                      status={st.attended > 3 ? 'present' : 'absent'}
                      label={st.attended > 3 ? 'Monitoring' : 'At-Risk Defaulter'}
                    />
                  </td>
                  <td className="actions-col">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => shareWhatsAppWarning(st)}
                    >
                      <MessageSquareIcon size={13} />
                      <span>WhatsApp Notice</span>
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function AdminAuditPanel() {
  const [query, setQuery] = useState('');

  const auditQuery = useAsync(async () => {
    const { data } = await supabase
      .from('students')
      .select('id, full_name, matric_no, user_id, passkey_id, device_token, claimed_at, suspended, created_at, classes(name, departments(name))')
      .order('claimed_at', { ascending: false, nullsFirst: false })
      .limit(200);
    return data ?? [];
  }, []);

  const list = auditQuery.data ?? [];
  const filtered = list.filter((st: any) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return st.full_name.toLowerCase().includes(q) || st.matric_no.toLowerCase().includes(q);
  });

  return (
    <section className="panel stack">
      <div className="section-head">
        <div>
          <h2>Anti-Proxy & Hardware Passkey Device Audit</h2>
          <p className="muted small">
            Verify biometric WebAuthn credentials, 1-phone hardware bindings, and phone claim security records.
          </p>
        </div>
        <Button size="sm" variant="secondary" onClick={() => void auditQuery.reload()}>
          <RefreshCwIcon size={13} />
          <span>Refresh audit logs</span>
        </Button>
      </div>

      <TextField
        label="Search student audit log"
        placeholder="Filter by name or matric number…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {auditQuery.loading ? (
        <PageLoader />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Student</th>
                <th>Matric No</th>
                <th>Class</th>
                <th>Hardware Passkey</th>
                <th>Device Token</th>
                <th>Claim Date</th>
                <th>Security Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((st: any) => (
                <tr key={st.id}>
                  <td>
                    <StudentCell name={st.full_name} />
                  </td>
                  <td className="mono">{st.matric_no}</td>
                  <td>{st.classes?.name ?? 'Class'}</td>
                  <td>
                    {st.passkey_id ? (
                      <Badge tone="ok">Passkey Bound</Badge>
                    ) : (
                      <Badge tone="muted">Unbound</Badge>
                    )}
                  </td>
                  <td className="mono" style={{ fontSize: '0.75rem' }}>
                    {st.device_token ? `${st.device_token.slice(0, 10)}…` : '—'}
                  </td>
                  <td className="muted nowrap">
                    {st.claimed_at ? formatDate(st.claimed_at) : 'Unclaimed'}
                  </td>
                  <td>
                    {st.suspended ? (
                      <StatusPill status="absent" label="Suspended" />
                    ) : st.user_id ? (
                      <StatusPill status="present" label="Active & Verified" />
                    ) : (
                      <StatusPill status="late" label="Pending Claim" />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
