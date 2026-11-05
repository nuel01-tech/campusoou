import { useState, type FormEvent } from 'react';
import { useAction, useAsync } from '@/hooks/useAsync';
import { useToast } from '@/hooks/useToast';
import { createRepAccount, deleteRep, listReps, setRepActive } from '@/services/admin';
import {
  Alert,
  Badge,
  Button,
  ConfirmButton,
  EmptyState,
  ErrorAlert,
  PageHeader,
  PageLoader,
  TextField,
} from '@/components/ui';
import { toAppError } from '@/lib/errors';
import { formatDate, pluralize } from '@/lib/format';
import type { RepSummary } from '@/types';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface CreatedCredentials {
  full_name: string;
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
  const toast = useToast();
  const [showForm, setShowForm] = useState(false);
  const [created, setCreated] = useState<CreatedCredentials | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  if (reps.loading) return <PageLoader />;

  const list = reps.data ?? [];
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
      toast(`Deleted ${rep.full_name}`);
    } catch (e) {
      toast(toAppError(e).message, 'error');
    } finally {
      setBusyId(null);
    }
  };

  const copyCredentials = async (c: CreatedCredentials) => {
    const text = `CampusPulse — Class Rep Login\nLink: ${window.location.origin}/rep/login\nEmail: ${c.email}\nPassword: ${c.password}`;
    try {
      await navigator.clipboard.writeText(text);
      toast('Login details copied to clipboard');
    } catch {
      toast('Could not copy automatically. Copy the details manually.', 'error');
    }
  };

  return (
    <div className="container">
      <PageHeader
        title="Class Rep Accounts"
        subtitle="Only you (Super Admin) can create, suspend, or remove class rep accounts."
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

      <ErrorAlert error={reps.error} onRetry={() => reps.reload()} />

      {created && (
        <Alert
          tone="success"
          title={`Created account for ${created.full_name}`}
          action={
            <Button size="sm" variant="secondary" onClick={() => copyCredentials(created)}>
              Copy login details
            </Button>
          }
        >
          Send these details to the class rep — they can sign in immediately at{' '}
          <span className="mono">{window.location.origin}/rep/login</span>:<br />
          Email: <strong className="mono">{created.email}</strong> · Password:{' '}
          <strong className="mono">{created.password}</strong>
        </Alert>
      )}

      {formVisible && (
        <NewRepForm
          onCancel={list.length ? () => setShowForm(false) : undefined}
          onCreated={(creds) => {
            setCreated(creds);
            setShowForm(false);
            toast(`Created class rep ${creds.full_name}`);
            void reps.reload({ silent: true });
          }}
        />
      )}

      {list.length === 0 && !reps.error ? (
        <EmptyState title="No class reps yet">
          Create an account above for each department or level's class representative.
        </EmptyState>
      ) : (
        list.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
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
    </div>
  );
}

function NewRepForm({
  onCancel,
  onCreated,
}: {
  onCancel?: () => void;
  onCreated: (creds: CreatedCredentials) => void;
}) {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState(() => generatePassword());
  const [touched, setTouched] = useState(false);

  const create = useAction(async () => {
    const clean = {
      full_name: fullName.trim(),
      email: email.trim().toLowerCase(),
      password,
    };
    await createRepAccount(clean);
    return clean;
  });

  const nameError = touched && fullName.trim().length < 2 ? 'Enter the class rep’s full name.' : null;
  const emailError = touched && !EMAIL_RE.test(email.trim()) ? 'Enter a valid email address.' : null;
  const passwordError = touched && password.length < 8 ? 'Password must be at least 8 characters.' : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (fullName.trim().length < 2 || !EMAIL_RE.test(email.trim()) || password.length < 8) return;
    const creds = await create.run();
    if (creds) onCreated(creds);
  };

  return (
    <form onSubmit={submit} noValidate className="panel stack">
      <h2>Create class rep account</h2>
      <div className="grid-2">
        <TextField
          label="Full name & department"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="e.g. Chinedu Okafor (CSC 300L)"
          error={nameError}
          autoFocus
        />
        <TextField
          label="Email address"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="rep@university.edu"
          autoComplete="off"
          error={emailError}
        />
      </div>
      <div className="password-row">
        <TextField
          label="Initial password"
          type="text"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mono-input"
          hint="Share this password with the class rep. No email confirmation is required."
          error={passwordError}
        />
        <Button type="button" variant="secondary" size="md" onClick={() => setPassword(generatePassword())}>
          Generate
        </Button>
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
