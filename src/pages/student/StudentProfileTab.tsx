import { useMemo, useState, type FormEvent } from 'react';
import type { User } from '@supabase/supabase-js';
import { Alert, Badge, Button, TextField } from '@/components/ui';
import { useToast } from '@/hooks/useToast';
import { createStudentLogin, updateStudentCredentials } from '@/services/auth';
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
      setProfileError(error instanceof Error ? error.message : 'Could not update your profile.');
    } finally {
      setSaving(false);
    }
  };

  const saveAccount = async (event: FormEvent) => {
    event.preventDefault();
    setAccountError('');
    if (password !== confirmPassword) {
      setAccountError('The passwords do not match.');
      return;
    }
    setAccountBusy(true);
    try {
      if (user?.is_anonymous) {
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
      setAccountError(error instanceof Error ? error.message : 'Could not update your login details.');
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
            <p className="muted small">Your saved details are read-only until you choose to edit them.</p>
          </div>
          <Badge tone="ok">Student record</Badge>
        </div>

        {!editing ? (
          <>
            <div className="table-wrap">
              <table className="table">
                <tbody>
                  <tr><th style={{ width: '210px' }}>Full name</th><td><strong>{student.full_name}</strong></td></tr>
                  <tr><th>Matric number</th><td className="mono">{student.matric_no}</td></tr>
                  <tr><th>Class / Cohort</th><td>{className}</td></tr>
                  <tr><th>Student status</th><td>{student.suspended ? <Badge tone="danger">Suspended</Badge> : <Badge tone="ok">Active</Badge>}</td></tr>
                  <tr><th>Profile claimed</th><td>{student.claimed_at ? new Date(student.claimed_at).toLocaleDateString() : 'Not available'}</td></tr>
                </tbody>
              </table>
            </div>
            <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <p className="fine-print">Your class, attendance history, passkey and device binding cannot be changed here.</p>
              <Button variant="secondary" onClick={() => setEditing(true)}>Edit Profile</Button>
            </div>
          </>
        ) : (
          <form className="stack" onSubmit={saveProfile}>
            <TextField label="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} required maxLength={160} />
            <TextField
              label="Matric number"
              value={matricNo}
              onChange={(e) => setMatricNo(e.target.value.toUpperCase())}
              required
              maxLength={40}
              disabled={Boolean(nextMatricChange)}
              hint={nextMatricChange
                ? `Matric number is locked until ${nextMatricChange.toLocaleString()}. You can still update your name.`
                : 'You can change your matric number once every 3 days.'}
            />
            {profileError && <Alert tone="error" title="Profile not saved">{profileError}</Alert>}
            <div className="row" style={{ justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <Button type="button" variant="ghost" onClick={cancelEdit}>Cancel</Button>
              <Button type="submit" loading={saving} disabled={!fullName.trim() || !matricNo.trim()}>Save Profile</Button>
            </div>
          </form>
        )}
      </section>

      <section className="panel stack">
        <div>
          <h2>Login & Account Security</h2>
          <p className="muted small">
            {user?.is_anonymous
              ? 'Create an email and password now. This upgrades the account you already claimed, preserving your attendance and passkey.'
              : 'Your permanent student login is active. You can update your email address or password below.'}
          </p>
        </div>
        {user?.email && <p className="small"><strong>Current login email:</strong> {user.email}</p>}
        {accountDone && <Alert tone="success" title="Login details saved">If you changed your email address, confirm the new address before signing out.</Alert>}
        <form className="stack" onSubmit={saveAccount}>
          <TextField
            label={user?.is_anonymous ? 'Email address' : 'New email address (optional)'}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required={Boolean(user?.is_anonymous)}
            hint={user?.is_anonymous ? 'Use an email address you can access.' : 'Leave blank to keep your current email.'}
          />
          <TextField
            label={user?.is_anonymous ? 'Create password' : 'New password (optional)'}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            required={Boolean(user?.is_anonymous)}
            hint="At least 8 characters."
          />
          <TextField
            label="Confirm password"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
            required={Boolean(password)}
          />
          {accountError && <Alert tone="error" title="Account update failed">{accountError}</Alert>}
          <Button type="submit" loading={accountBusy} disabled={user?.is_anonymous ? (!email.trim() || password.length < 8 || !confirmPassword) : (!email.trim() && !password)}>
            {user?.is_anonymous ? 'Create Student Login' : 'Update Login Details'}
          </Button>
        </form>
        <p className="fine-print">Never share your password or passkey. Your matric number, class placement and device identity are protected separately from login credentials.</p>
      </section>
    </div>
  );
}
