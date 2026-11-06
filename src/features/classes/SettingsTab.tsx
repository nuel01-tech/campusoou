import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAction, useAsync } from '@/hooks/useAsync';
import { useToast } from '@/hooks/useToast';
import { deleteClass, updateClass } from '@/services/classes';
import { listDepartments } from '@/services/admin';
import { Button, ConfirmButton, ErrorAlert, SelectField, TextField } from '@/components/ui';
import { ACADEMIC_LEVELS, type ClassRoom } from '@/types';

export function SettingsTab({ klass, onUpdated }: { klass: ClassRoom; onUpdated: (c: ClassRoom) => void }) {
  const navigate = useNavigate();
  const toast = useToast();
  const departments = useAsync(listDepartments, []);
  const [name, setName] = useState(klass.name);
  const [departmentId, setDepartmentId] = useState(klass.department_id ?? '');
  const [level, setLevel] = useState(klass.level ?? '');
  const [start, setStart] = useState(klass.semester_start ?? '');

  const save = useAction(() =>
    updateClass(klass.id, {
      name: name.trim(),
      department_id: departmentId || null,
      level: level || null,
      semester_start: start || null,
    }),
  );
  const remove = useAction(async () => {
    await deleteClass(klass.id);
    return true;
  });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (name.trim().length < 2) return;
    const updated = await save.run();
    if (updated) {
      onUpdated(updated);
      toast('Saved');
    }
  };

  const handleDelete = async () => {
    if (await remove.run()) {
      toast('Class deleted');
      navigate('/rep', { replace: true });
    }
  };

  const deptList = departments.data ?? [];
  const dirty =
    name.trim() !== klass.name ||
    (departmentId || null) !== (klass.department_id || null) ||
    (level || null) !== (klass.level || null) ||
    (start || null) !== klass.semester_start;

  return (
    <div className="stack-lg">
      <form onSubmit={submit} className="panel stack" noValidate>
        <h2>Class details</h2>
        <TextField
          label="Class name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={name.trim().length < 2 ? 'Give the class a name.' : null}
        />

        <div className="grid-2">
          <SelectField
            label="Department"
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}
            hint="Department this class belongs to."
          >
            <option value="">Select department (optional)…</option>
            {deptList.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </SelectField>

          <SelectField
            label="Academic level"
            value={level}
            onChange={(e) => setLevel(e.target.value)}
            hint="Level of study for this class."
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
          label="Semester start date"
          type="date"
          value={start}
          onChange={(e) => setStart(e.target.value)}
          hint="Week 1 is the week containing this date."
        />
        <ErrorAlert error={save.error} />
        <div>
          <Button type="submit" loading={save.pending} disabled={!dirty}>
            Save changes
          </Button>
        </div>
      </form>

      <section className="panel panel-danger stack">
        <h2>Delete class</h2>
        <p className="muted">Removes the class list, all sessions and all attendance records. This cannot be undone.</p>
        <ErrorAlert error={remove.error} />
        <div>
          <ConfirmButton onConfirm={handleDelete} loading={remove.pending} confirmText="Tap again to delete everything">
            Delete this class
          </ConfirmButton>
        </div>
      </section>
    </div>
  );
}
