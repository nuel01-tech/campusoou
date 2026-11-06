import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useAction, useAsync } from '@/hooks/useAsync';
import { supabase } from '@/services/db';
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
  StatusPill,
  StudentCell,
  TextField,
} from '@/components/ui';
import { KpiStatGrid, VerticalTabs, type VerticalTabItem } from '@/components/saas';
import {
  AlertCircleIcon,
  GraduationCapIcon,
  LayoutDashboardIcon,
  MessageSquareIcon,
  PlusIcon,
  ShieldCheckIcon,
} from '@/components/icons';
import { formatDate } from '@/lib/format';
import { ACADEMIC_LEVELS, type Department } from '@/types';

type RepWorkspaceTab = 'directory' | 'create' | 'defaulters' | 'audit' | 'guide';

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
    rawTab && ['directory', 'create', 'defaulters', 'audit', 'guide'].includes(rawTab)
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
      icon: <LayoutDashboardIcon size={16} />,
    },
    {
      key: 'create',
      label: 'Create New Class',
      description: 'Choose department, level & start date',
      badge: '+',
      icon: <PlusIcon size={16} />,
    },
    {
      key: 'defaulters',
      label: 'Defaulters Watchlist',
      description: 'Students below 75% NUC benchmark',
      icon: <AlertCircleIcon size={16} />,
    },
    {
      key: 'audit',
      label: 'Device & Anti-Proxy Audit',
      description: 'Passkey & phone binding records',
      icon: <ShieldCheckIcon size={16} />,
    },
    {
      key: 'guide',
      label: 'Operations Guide',
      description: 'Roster upload, GPS & 75% rules',
      icon: <GraduationCapIcon size={16} />,
    },
  ];

  return (
    <div className="container stack-lg">
      <PageHeader
        eyebrow="Class Representative Workspace"
        title="Classes & Cohort Management"
        subtitle={
          repDeptName || profile?.level
            ? `Assigned Department: ${[repDeptName, profile?.level].filter(Boolean).join(' · ')}`
            : 'Create classes by department and level, import rosters, and run live GPS attendance sessions.'
        }
        actions={
          activeTab !== 'create' && (
            <Button onClick={() => setTab('create')}>
              <PlusIcon size={15} />
              <span>New Class</span>
            </Button>
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
            tone: 'purple',
          },
          {
            label: 'Exam Benchmark',
            value: '75%',
            sublabel: 'Automatic NUC eligibility tracking',
            tone: 'warn',
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
                    <PlusIcon size={14} />
                    <span>Create class</span>
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

          {activeTab === 'defaulters' && <RepDefaultersPanel classes={list} />}

          {activeTab === 'audit' && <RepAuditPanel classes={list} />}

          {activeTab === 'guide' && (
            <div className="panel stack">
              <div>
                <h2>Class Rep Operations Guide</h2>
                <p className="muted small">
                  Standard operating workflow for Olabisi Onabanjo University (OOU) Class Representatives.
                </p>
              </div>
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

function RepDefaultersPanel({ classes }: { classes: any[] }) {
  const [selectedClassId, setSelectedClassId] = useState<string>(classes[0]?.id ?? '');
  const [query, setQuery] = useState('');

  const defaultersQuery = useAsync(async () => {
    if (!selectedClassId) return [];
    const { data: students } = await supabase
      .from('students')
      .select('id, full_name, matric_no')
      .eq('class_id', selectedClassId)
      .order('full_name');

    if (!students || students.length === 0) return [];

    const { data: sessions } = await supabase
      .from('sessions')
      .select('id')
      .eq('class_id', selectedClassId);

    const sessionCount = sessions?.length ?? 0;
    const sessionIds = (sessions ?? []).map((s) => s.id);

    const { data: attendanceRows } = await supabase
      .from('attendance')
      .select('student_id')
      .in('session_id', sessionIds.length > 0 ? sessionIds : ['00000000-0000-0000-0000-000000000000']);

    const counts = new Map<string, number>();
    for (const a of attendanceRows ?? []) {
      counts.set(a.student_id, (counts.get(a.student_id) ?? 0) + 1);
    }

    return students.map((st) => {
      const attended = counts.get(st.id) ?? 0;
      const rate = sessionCount > 0 ? Math.round((attended / sessionCount) * 100) : 0;
      return {
        ...st,
        attended,
        totalSessions: sessionCount,
        rate,
        isDefaulter: rate < 75,
      };
    });
  }, [selectedClassId]);

  const list = (defaultersQuery.data ?? []).filter((st) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return st.full_name.toLowerCase().includes(q) || st.matric_no.toLowerCase().includes(q);
  });

  const selectedClass = classes.find((c) => c.id === selectedClassId);

  const shareWhatsAppNotice = (st: (typeof list)[0]) => {
    const text = [
      `*CAMPUS ATTENDANCE WARNING — 75% EXAM THRESHOLD*`,
      `Student: ${st.full_name} (${st.matric_no})`,
      `Cohort: ${selectedClass?.name ?? 'Class'}`,
      `Attendance Record: ${st.attended}/${st.totalSessions} sessions (${st.rate}%)`,
      `\n*Notice:* You have fallen below the 75% attendance threshold required to sit for semester examinations. Please ensure your attendance is updated and see your Class Representative immediately.`,
    ].join('\n');
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="panel stack">
      <div className="section-head">
        <div>
          <h2>Defaulters Watchlist (&lt; 75% NUC Benchmark)</h2>
          <p className="muted small">
            Quickly audit and warn students whose attendance rate is below exam qualification criteria.
          </p>
        </div>
      </div>

      <div className="filter-bar">
        <SelectField
          label="Select Class Cohort"
          value={selectedClassId}
          onChange={(e) => setSelectedClassId(e.target.value)}
        >
          {classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} {c.level ? `(${c.level})` : ''}
            </option>
          ))}
        </SelectField>
        <TextField
          label="Search student"
          placeholder="Name or matric number…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {defaultersQuery.loading ? (
        <PageLoader />
      ) : list.length === 0 ? (
        <p className="muted small">No students found for this class.</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Student</th>
                <th>Matric No</th>
                <th className="num">Attended</th>
                <th className="num">Rate</th>
                <th>Status</th>
                <th className="actions-col">Action</th>
              </tr>
            </thead>
            <tbody>
              {list.map((st) => (
                <tr key={st.id}>
                  <td>
                    <StudentCell name={st.full_name} />
                  </td>
                  <td className="mono">{st.matric_no}</td>
                  <td className="num mono">
                    {st.attended} / {st.totalSessions}
                  </td>
                  <td className="num font-bold">
                    <span style={{ color: st.rate >= 75 ? 'var(--ok)' : 'var(--danger)' }}>
                      {st.rate}%
                    </span>
                  </td>
                  <td>
                    <StatusPill
                      status={st.rate >= 75 ? 'present' : 'absent'}
                      label={st.rate >= 75 ? 'Eligible' : 'Below 75%'}
                    />
                  </td>
                  <td className="actions-col">
                    <Button
                      size="sm"
                      variant={st.rate < 75 ? 'secondary' : 'ghost'}
                      onClick={() => shareWhatsAppNotice(st)}
                    >
                      <MessageSquareIcon size={13} />
                      <span>WhatsApp Warning</span>
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function RepAuditPanel({ classes }: { classes: any[] }) {
  const [selectedClassId, setSelectedClassId] = useState<string>(classes[0]?.id ?? '');
  const [query, setQuery] = useState('');

  const auditQuery = useAsync(async () => {
    if (!selectedClassId) return [];
    const { data } = await supabase
      .from('students')
      .select('id, full_name, matric_no, user_id, passkey_id, device_token, claimed_at, suspended, created_at')
      .eq('class_id', selectedClassId)
      .order('full_name');
    return data ?? [];
  }, [selectedClassId]);

  const list = (auditQuery.data ?? []).filter((st: any) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return st.full_name.toLowerCase().includes(q) || st.matric_no.toLowerCase().includes(q);
  });

  return (
    <div className="panel stack">
      <div className="section-head">
        <div>
          <h2>Device & Anti-Proxy Audit</h2>
          <p className="muted small">
            Verify student hardware WebAuthn passkey binding and 1-phone physical device tokens to eliminate proxy attendance.
          </p>
        </div>
      </div>

      <div className="filter-bar">
        <SelectField
          label="Select Class Cohort"
          value={selectedClassId}
          onChange={(e) => setSelectedClassId(e.target.value)}
        >
          {classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} {c.level ? `(${c.level})` : ''}
            </option>
          ))}
        </SelectField>
        <TextField
          label="Search student audit log"
          placeholder="Filter by name or matric number…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {auditQuery.loading ? (
        <PageLoader />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Student</th>
                <th>Matric No</th>
                <th>Hardware Passkey</th>
                <th>Device Token</th>
                <th>Claim Date</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {list.map((st: any) => (
                <tr key={st.id}>
                  <td>
                    <StudentCell name={st.full_name} />
                  </td>
                  <td className="mono">{st.matric_no}</td>
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
                      <StatusPill status="present" label="Verified Device" />
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
    </div>
  );
}
