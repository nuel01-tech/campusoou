import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAction, useAsync } from '@/hooks/useAsync';
import { useToast } from '@/hooks/useToast';
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
  TextField,
} from '@/components/ui';
import { KpiStatGrid, VerticalTabs, type VerticalTabItem } from '@/components/saas';
import { toAppError } from '@/lib/errors';
import { formatDate, pluralize } from '@/lib/format';
import { ACADEMIC_LEVELS, type Department, type RepSummary } from '@/types';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type AdminTabKey = 'overview' | 'reps' | 'create' | 'departments';

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
    rawTab && ['overview', 'reps', 'create', 'departments'].includes(rawTab)
      ? rawTab
      : 'overview';

  const setTab = (tab: AdminTabKey) => {
    setSearchParams({ tab });
  };

  const list = reps.data ?? [];
  const deptList = departments.data ?? [];

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

  const tabItems: VerticalTabItem<AdminTabKey>[] = [
    {
      key: 'overview',
      label: 'Executive Overview',
      description: 'KPI metrics & department summary',
    },
    {
      key: 'reps',
      label: 'Class Rep Directory',
      description: 'Search, filter & manage reps',
      badge: list.length,
    },
    {
      key: 'create',
      label: 'Provision Class Rep',
      description: 'Assign department, level & login',
      badge: '+',
    },
    {
      key: 'departments',
      label: 'Departments Manager',
      description: 'Add or remove departments',
      badge: deptList.length,
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
        title="Super Admin Control Center"
        subtitle="Manage university departments, provision Class Rep accounts by level, and oversee attendance operations."
        actions={
          <div className="row">
            <Button variant="secondary" onClick={() => setTab('departments')}>
              + Department
            </Button>
            <Button
              onClick={() => {
                setCreated(null);
                setTab('create');
              }}
            >
              + New Class Rep
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
            tone: 'default',
          },
          {
            label: 'Enrolled Students',
            value: totalStudentsCount,
            sublabel: 'Total students on class rosters',
            tone: 'default',
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
                Copy details
              </Button>
              <Button size="sm" variant="ghost" onClick={() => shareCredentialsWhatsApp(created)}>
                WhatsApp
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
                                + Add rep here
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
                          <th>Name</th>
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
                              <strong>{r.full_name}</strong>
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
                              {r.active ? <Badge tone="ok">Active</Badge> : <Badge tone="muted">Suspended</Badge>}
                            </td>
                            <td className="num">{r.class_count}</td>
                            <td className="num">{r.student_count}</td>
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
                  + Provision rep
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
                        <th>Name</th>
                        <th>Department</th>
                        <th>Level</th>
                        <th>Email</th>
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
                              <strong>{r.full_name}</strong>
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
                            <td className="mono">{r.email}</td>
                            <td className="num">{r.class_count}</td>
                            <td className="num">{r.student_count}</td>
                            <td>
                              {r.active ? (
                                <Badge tone="ok">Active</Badge>
                              ) : (
                                <Badge tone="muted">Suspended</Badge>
                              )}
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
                          <td colSpan={9} className="muted center">
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
        <span className="muted small">{pluralize(departments.length, 'department', 'departments')}</span>
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
          Add department
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
