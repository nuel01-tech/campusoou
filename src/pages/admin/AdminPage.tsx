import { useEffect, useState, type FormEvent } from 'react';
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
import { toAppError } from '@/lib/errors';
import { formatDate, pluralize } from '@/lib/format';
import type { Department, RepSummary } from '@/types';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface CreatedCredentials {
  full_name: string;
  department_name: string;
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
  const [showForm, setShowForm] = useState(false);
  const [created, setCreated] = useState<CreatedCredentials | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selectedDeptId, setSelectedDeptId] = useState<string>('');

  if (reps.loading || departments.loading) return <PageLoader />;

  const list = reps.data ?? [];
  const deptList = departments.data ?? [];
  const formVisible = showForm || list.length === 0;

  const handleToggleActive = async (rep: RepSummary) => {
    setBusyId(rep.id);
    try {
      const updated = await setRepActive(rep.id, !rep.active);
      reps.setData((prev) => (prev ?? []).map((r) => (r.id === rep.id ? { ...r, active: updated.active } : r)));
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

  return (
    <div className="container stack-lg">
      <PageHeader
        title="Super Admin Dashboard"
        subtitle="Create departments first, then assign each Class Rep to their department when creating their account."
        actions={
          !formVisible && (
            <Button
              onClick={() => {
                setCreated(null);
                setShowForm(true);
              }}
            >
              New class rep
            </Button>
          )
        }
      />

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

      <section className="stack">
        <div className="section-head">
          <h2>Class Rep Accounts</h2>
          <span className="muted small">{pluralize(list.length, 'rep', 'reps')}</span>
        </div>

        <ErrorAlert error={reps.error} onRetry={() => reps.reload()} />

        {created && (
          <Alert
            tone="success"
            title={`Created account for ${created.full_name} (${created.department_name})`}
            action={
              <Button size="sm" variant="secondary" onClick={() => copyCredentials(created)}>
                Copy login details
              </Button>
            }
          >
            Send these details to the class rep — they can sign in immediately at{' '}
            <span className="mono">{window.location.origin}/rep/login</span>:<br />
            Department: <strong>{created.department_name}</strong> · Email:{' '}
            <strong className="mono">{created.email}</strong> · Password:{' '}
            <strong className="mono">{created.password}</strong>
          </Alert>
        )}

        {formVisible && (
          <NewRepForm
            departments={deptList}
            defaultDepartmentId={selectedDeptId}
            onCancel={list.length ? () => setShowForm(false) : undefined}
            onCreated={(creds) => {
              setCreated(creds);
              setShowForm(false);
              toast(`Created class rep ${creds.full_name}`);
              void reps.reload({ silent: true });
              void departments.reload({ silent: true });
            }}
          />
        )}

        {list.length === 0 && !reps.error ? (
          <EmptyState title="No class reps yet">
            Create a department above, then create a Class Rep account and choose their department.
          </EmptyState>
        ) : (
          list.length > 0 && (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Department</th>
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
                  {list.map((r) => {
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
                        <td className="mono">{r.email}</td>
                        <td className="num">{r.class_count}</td>
                        <td className="num">{r.student_count}</td>
                        <td>{r.active ? <Badge tone="ok">Active</Badge> : <Badge tone="muted">Suspended</Badge>}</td>
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
                </tbody>
              </table>
            </div>
          )
        )}
      </section>
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
          <h2>1. Departments</h2>
          <p className="muted small">
            Add departments here so you can select them when creating Class Rep accounts below.
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
        />
        <Button type="submit" variant="secondary" loading={create.pending}>
          Add department
        </Button>
      </form>

      <ErrorAlert error={create.error ?? error} onRetry={error ? onRetry : undefined} />

      {departments.length === 0 ? (
        <p className="muted small">
          No departments created yet. Add your first department above (e.g. Computer Science) before creating a Class Rep.
        </p>
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
  onCancel,
  onCreated,
}: {
  departments: Department[];
  defaultDepartmentId?: string;
  onCancel?: () => void;
  onCreated: (creds: CreatedCredentials) => void;
}) {
  const [fullName, setFullName] = useState('');
  const [departmentId, setDepartmentId] = useState(defaultDepartmentId || (departments[0]?.id ?? ''));
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
      email: email.trim().toLowerCase(),
      password,
    };
    await createRepAccount({
      full_name: clean.full_name,
      email: clean.email,
      password: clean.password,
      department_id: clean.department_id,
    });
    return clean;
  });

  const nameError = touched && fullName.trim().length < 2 ? 'Enter the class rep’s full name.' : null;
  const deptError =
    touched && !departmentId
      ? departments.length === 0
        ? 'Create a department in section 1 above first.'
        : 'Choose a department for this class rep.'
      : null;
  const emailError = touched && !EMAIL_RE.test(email.trim()) ? 'Enter a valid email address.' : null;
  const passwordError = touched && password.length < 8 ? 'Password must be at least 8 characters.' : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (
      fullName.trim().length < 2 ||
      !departmentId ||
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
      <h2>2. Create Class Rep account</h2>
      <div className="grid-2">
        <TextField
          label="Class rep full name"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="e.g. Chinedu Okafor (300L)"
          error={nameError}
          autoFocus
        />
        <SelectField
          label="Department"
          value={departmentId}
          onChange={(e) => setDepartmentId(e.target.value)}
          error={deptError}
          disabled={departments.length === 0}
          hint={
            departments.length === 0
              ? 'Add a department in "1. Departments" above first.'
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
          <Button type="button" variant="secondary" size="md" onClick={() => setPassword(generatePassword())}>
            Generate
          </Button>
        </div>
      </div>
      <ErrorAlert error={create.error} />
      <div className="row">
        <Button type="submit" loading={create.pending}>
          Create class rep
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
