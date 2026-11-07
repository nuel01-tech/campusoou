import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { User } from '@supabase/supabase-js';
import { Alert, Badge, Button, TextField } from '@/components/ui';
import { KeyRoundIcon, ShieldCheckIcon } from '@/components/icons';
import { useToast } from '@/hooks/useToast';
import { toAppError } from '@/lib/errors';
import {
  createStudentLogin,
  hasPermanentStudentLogin,
  updateStudentCredentials,
} from '@/services/auth';
import { updateMyStudentProfile } from '@/services/student';
import type { Student } from '@/types';

interface Props {
  student: Student;
  className: string;
  user: User | null;
  onSaved: (student: Student) => void;
  onAuthUpdated: () => Promise<void>;
}

export function StudentProfileTab({ student, className, user, onSaved, onAuthUpdated }: Props) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [fullName, setFullName] = useState(student.full_name);
  const [matricNo, setMatricNo] = useState(student.matric_no);
  const [saving, setSaving] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountError, setAccountError] = useState('');
  const [accountDone, setAccountDone] = useState(false);

  const hasPermanentLogin = hasPermanentStudentLogin(user);

  useEffect(() => {
    if (!editing) {
      setFullName(student.full_name);
      setMatricNo(student.matric_no);
    }
  }, [student.full_name, student.matric_no, editing]);

  const nextMatricChange = useMemo(() => {
    if (!student.matric_changed_at) return null;
    const next = new Date(new Date(student.matric_changed_at).getTime() + 3 * 24 * 60 * 60 * 1000);
    return next.getTime() > Date.now() ? next : null;
  }, [student.matric_changed_at]);

  const cancelEdit = () => {
    setFullName(student.full_name);
    setMatricNo(student.matric_no);
    setProfileError('');
    setEditing(false);
  };

  const saveProfile = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setProfileError('');
    try {
      const updated = await updateMyStudentProfile(fullName, matricNo);
      onSaved(updated);
      setEditing(false);
      toast('Your student profile has been updated.');
    } catch (error) {
      setProfileError(toAppError(error).message);
    } finally {
      setSaving(false);
    }
  };

  const saveAccount = async (event: FormEvent) => {
    event.preventDefault();
    setAccountError('');
    setAccountDone(false);

    if (password && password !== confirmPassword) {
      setAccountError('The passwords do not match.');
      return;
    }

    setAccountBusy(true);
    try {
      if (!hasPermanentLogin) {
        if (!email.trim()) throw new Error('Enter an email address to create a permanent login.');
        if (password.length < 8) throw new Error('Your password must contain at least 8 characters.');
        await createStudentLogin(email, password);
      } else {
        await updateStudentCredentials(email, password);
      }
      await onAuthUpdated();
      setEmail('');
      setPassword('');
      setConfirmPassword('');
      setAccountDone(true);
      toast('Your student login details have been saved.');
    } catch (error) {
      setAccountError(toAppError(error).message);
    } finally {
      setAccountBusy(false);
    }
  };

  return (
    <div className="stack">
      <section className="panel stack">
        <div className="section-head">
          <div>
            <h2>My Student Profile</h2>
            <p className="muted small">Your saved academic details are read-only until you choose to edit them.</p>
          </div>
          <Badge tone="ok" icon={<ShieldCheckIcon size={12} />}>
            Student Record
          </Badge>
        </div>

        {!editing ? (
          <>
            <div className="table-wrap">
              <table className="table">
                <tbody>
                  <tr>
                    <th style={{ width: '210px' }}>Full name</th>
                    <td>
                      <strong>{student.full_name}</strong>
                    </td>
                  </tr>
                  <tr>
                    <th>Matric number</th>
                    <td className="mono">{student.matric_no}</td>
                  </tr>
                  <tr>
                    <th>Class / Cohort</th>
                    <td>{className}</td>
                  </tr>
                  <tr>
                    <th>Student status</th>
                    <td>
                      {student.suspended ? (
                        <Badge tone="danger">Suspended</Badge>
                      ) : (
                        <Badge tone="ok">Active</Badge>
                      )}
                    </td>
                  </tr>
                  <tr>
                    <th>Profile claimed</th>
                    <td>
                      {student.claimed_at
                        ? new Date(student.claimed_at).toLocaleDateString()
                        : 'Not available'}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <p className="fine-print">
                Your class cohort, attendance history, passkey, and device binding cannot be changed here.
              </p>
              <Button variant="secondary" onClick={() => setEditing(true)}>
                Edit Profile
              </Button>
            </div>
          </>
        ) : (
          <form className="stack" onSubmit={saveProfile}>
            <TextField
              label="Full name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
              maxLength={160}
            />
            <TextField
              label="Matric number"
              value={matricNo}
              onChange={(e) => setMatricNo(e.target.value.toUpperCase())}
              required
              maxLength={40}
              disabled={Boolean(nextMatricChange)}
              hint={
                nextMatricChange
                  ? `Matric number is locked until ${nextMatricChange.toLocaleString()}. You can still update your name.`
                  : 'You can change your matric number once every 3 days.'
              }
            />
            {profileError && (
              <Alert tone="error" title="Profile not saved">
                {profileError}
              </Alert>
            )}
            <div className="row" style={{ justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <Button type="button" variant="ghost" onClick={cancelEdit}>
                Cancel
              </Button>
              <Button
                type="submit"
                loading={saving}
                disabled={!fullName.trim() || !matricNo.trim()}
              >
                Save Profile
              </Button>
            </div>
          </form>
        )}
      </section>

      <section className="panel stack">
        <div className="section-head">
          <div>
            <h2>Login & Account Security</h2>
            <p className="muted small">
              {!hasPermanentLogin
                ? 'Create an email and password now. This upgrades the account you already claimed, preserving your attendance and passkey.'
                : 'Your permanent student login is active. You can update your email address or password below.'}
            </p>
          </div>
          <Badge tone={hasPermanentLogin ? 'ok' : 'warn'} icon={<KeyRoundIcon size={12} />}>
            {hasPermanentLogin ? 'Permanent Login Active' : 'Setup Recommended'}
          </Badge>
        </div>

        {user?.email && (
          <div className="row" style={{ gap: '0.5rem' }}>
            <span className="muted small">Current login email:</span>
            <strong className="mono small">{user.email}</strong>
          </div>
        )}

        {accountDone && (
          <Alert tone="success" title="Student login is ready">
            Your login credentials are saved. You can now safely sign out and sign back in anytime at{' '}
            <strong className="mono">/student/login</strong> using your email address and password.
          </Alert>
        )}

        <form className="stack" onSubmit={saveAccount}>
          <TextField
            label={!hasPermanentLogin ? 'Email address' : 'New email address (optional)'}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={user?.email || 'student@oouagoiwoye.edu.ng'}
            autoComplete="email"
            required={!hasPermanentLogin}
            hint={
              !hasPermanentLogin
                ? 'Use an email address you will remember when signing in.'
                : 'Leave blank to keep your current login email.'
            }
          />
          <TextField
            label={!hasPermanentLogin ? 'Create password' : 'New password (optional)'}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
            autoComplete="new-password"
            required={!hasPermanentLogin}
            hint="At least 8 characters."
          />
          <TextField
            label="Confirm password"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Re-enter password"
            autoComplete="new-password"
            required={!hasPermanentLogin || Boolean(password)}
          />
          {accountError && (
            <Alert tone="error" title="Account update failed">
              {accountError}
            </Alert>
          )}
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <Button
              type="submit"
              loading={accountBusy}
              disabled={
                !hasPermanentLogin
                  ? !email.trim() || password.length < 8 || !confirmPassword
                  : !email.trim() && !password
              }
            >
              {!hasPermanentLogin ? 'Create Student Login' : 'Update Login Details'}
            </Button>
          </div>
        </form>
        <p className="fine-print">
          Never share your password or passkey. Your matric number, class placement, and device identity are protected separately from login credentials.
        </p>
      </section>
    </div>
  );
}
