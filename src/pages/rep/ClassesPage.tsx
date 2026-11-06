import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
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
import { formatDate } from '@/lib/format';
import { ACADEMIC_LEVELS, type Department } from '@/types';

export default function ClassesPage() {
  const classes = useAsync(listClasses, []);
  const departments = useAsync(listDepartments, []);
  const { profile } = useAuth();
  const [showForm, setShowForm] = useState(false);

  if (classes.loading) return <PageLoader />;

  const list = classes.data ?? [];
  const deptList = departments.data ?? [];
  const formVisible = showForm || list.length === 0;

  return (
    <div className="container">
      <PageHeader
        title="Your classes"
        subtitle={
          profile?.department_id && deptList.length > 0
            ? `${deptList.find((d) => d.id === profile.department_id)?.name ?? ''} ${profile.level ? `(${profile.level})` : ''}`.trim()
            : undefined
        }
        actions={
          !formVisible && (
            <Button variant="secondary" onClick={() => setShowForm(true)}>
              New class
            </Button>
          )
        }
      />
      <ErrorAlert error={classes.error} onRetry={() => classes.reload()} />

      {formVisible && (
        <NewClassForm
          departments={deptList}
          defaultDepartmentId={profile?.department_id ?? undefined}
          defaultLevel={profile?.level ?? undefined}
          onCancel={list.length ? () => setShowForm(false) : undefined}
        />
      )}

      {list.length > 0 && (
        <ul className="list">
          {list.map((c) => (
            <li key={c.id}>
              <Link to={`/rep/class/${c.id}`} className="list-row">
                <div>
                  <p className="list-title">{c.name}</p>
                  <div className="row" style={{ marginTop: '0.25rem', gap: '0.4rem' }}>
                    {c.department_name && <Badge tone="neutral">{c.department_name}</Badge>}
                    {c.level && <Badge tone="ok">{c.level}</Badge>}
                    <span className="muted small">Created {formatDate(c.created_at)}</span>
                  </div>
                </div>
                <span className="mono code-chip">{c.join_code}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {!list.length && !classes.error && (
        <EmptyState title="Start by creating a class">
          Choose a department, level, and class name (e.g. "CSC 301 - Operating Systems"). You'll upload the class list next.
        </EmptyState>
      )}
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
  const [departmentId, setDepartmentId] = useState(defaultDepartmentId || (departments[0]?.id ?? ''));
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
      <h2>New class</h2>
      <TextField
        label="Class name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="e.g. CSC 301 — Operating Systems"
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
              ? 'No departments added yet.'
              : 'Choose the department this class belongs to.'
          }
        >
          <option value="">Select department (optional)…</option>
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
          hint="Select the academic level."
        >
          <option value="">Select level (optional)…</option>
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
        hint="Used to fill in the week number for each session. You can change it later."
      />
      <ErrorAlert error={create.error} />
      <div className="row">
        <Button type="submit" loading={create.pending}>
          Create class
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
