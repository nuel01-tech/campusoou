import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/useToast';
import { hasPermanentStudentLogin, signOut } from '@/services/auth';
import { listClasses } from '@/services/classes';
import { toAppError } from '@/lib/errors';
import { Badge, getInitials } from './ui';
import { CommandPalette, type CommandItem } from './saas';
import {
  ActivityIcon,
  AlertCircleIcon,
  AwardIcon,
  BookOpenIcon,
  Building2Icon,
  CalendarDaysIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ClipboardCheckIcon,
  FileSpreadsheetIcon,
  GraduationCapIcon,
  KeyRoundIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  MenuIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  ShieldCheckIcon,
  SmartphoneIcon,
  UserPlusIcon,
  UsersIcon,
  XIcon,
} from './icons';
import type { ClassRoom } from '@/types';

interface NavEntry {
  id: string;
  label: string;
  to: string;
  match: (pathname: string, searchParams: URLSearchParams) => boolean;
  badge?: string;
  icon: ReactNode;
}

const ACTIVE_CLASS_KEY = 'campuspulse_active_class_id';

export function Shell({ children }: { children: ReactNode }) {
  const { role, profile, user, refreshAuth } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const toast = useToast();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [userClasses, setUserClasses] = useState<ClassRoom[]>([]);

  // Load user's classes when staff is signed in
  useEffect(() => {
    if (role === 'rep' || role === 'super_admin') {
      listClasses()
        .then((cls) => setUserClasses(cls))
        .catch(() => {});
    }
  }, [role, location.pathname]);

  // Close mobile sidebar on route change
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname, location.search]);

  // Global Ctrl+K / Cmd+K shortcut for Command Palette
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCmdOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const handleSignOut = async () => {
    if (role === 'student' && !hasPermanentStudentLogin(user)) {
      toast(
        'Create your student email and password login in My Profile before signing out, so you can access your account again.',
        'error',
      );
      navigate('/me?tab=profile', { replace: true });
      return;
    }
    try {
      await signOut();
      await refreshAuth();
      navigate('/', { replace: true });
    } catch (e) {
      toast(toAppError(e).message, 'error');
    }
  };

  const homePath =
    role === 'super_admin' ? '/admin' : role === 'rep' ? '/rep' : role === 'student' ? '/me' : '/';

  const onPublicOrAuthPage =
    location.pathname === '/' ||
    location.pathname.startsWith('/join') ||
    location.pathname.startsWith('/student/login') ||
    location.pathname.startsWith('/rep/login') ||
    location.pathname.startsWith('/admin/login') ||
    location.pathname.startsWith('/admin/setup') ||
    location.pathname.startsWith('/admin/forgot-password') ||
    location.pathname.startsWith('/admin/reset-password');

  const showSaasSidebar = Boolean(role) && !onPublicOrAuthPage;

  // Extract or remember active classId
  const classMatch = /^\/rep\/class\/([^/]+)/.exec(location.pathname);
  const urlClassId = classMatch ? classMatch[1] : null;

  useEffect(() => {
    if (urlClassId) {
      try {
        localStorage.setItem(ACTIVE_CLASS_KEY, urlClassId);
      } catch {}
    }
  }, [urlClassId]);

  const activeClassId = useMemo(() => {
    if (urlClassId) return urlClassId;
    try {
      const stored = localStorage.getItem(ACTIVE_CLASS_KEY);
      if (stored && userClasses.some((c) => c.id === stored)) return stored;
    } catch {}
    return userClasses[0]?.id ?? null;
  }, [urlClassId, userClasses]);

  const activeClass = userClasses.find((c) => c.id === activeClassId);

  const handleSwitchClass = (id: string) => {
    try {
      localStorage.setItem(ACTIVE_CLASS_KEY, id);
    } catch {}
    setMobileMenuOpen(false);
    navigate(`/rep/class/${id}`);
  };

  const primaryNav = useMemo<NavEntry[]>(() => {
    if (role === 'super_admin') {
      return [
        {
          id: 'admin-overview',
          label: 'Executive Overview',
          to: '/admin?tab=overview',
          match: (p, sp) => p === '/admin' && (!sp.get('tab') || sp.get('tab') === 'overview'),
          icon: <LayoutDashboardIcon size={16} />,
        },
        {
          id: 'admin-live',
          label: 'Live Campus Sessions',
          to: '/admin?tab=live-sessions',
          match: (p, sp) => p === '/admin' && sp.get('tab') === 'live-sessions',
          badge: 'Live',
          icon: <ClipboardCheckIcon size={16} />,
        },
        {
          id: 'admin-defaulters',
          label: 'Defaulters Watchlist (<75%)',
          to: '/admin?tab=defaulters',
          match: (p, sp) => p === '/admin' && sp.get('tab') === 'defaulters',
          icon: <AlertCircleIcon size={16} />,
        },
        {
          id: 'admin-reps',
          label: 'Class Rep Directory',
          to: '/admin?tab=reps',
          match: (p, sp) => p === '/admin' && sp.get('tab') === 'reps',
          icon: <UsersIcon size={16} />,
        },
        {
          id: 'admin-create',
          label: 'Provision Class Rep',
          to: '/admin?tab=create',
          match: (p, sp) => p === '/admin' && sp.get('tab') === 'create',
          icon: <UserPlusIcon size={16} />,
        },
        {
          id: 'admin-depts',
          label: 'Departments Manager',
          to: '/admin?tab=departments',
          match: (p, sp) => p === '/admin' && sp.get('tab') === 'departments',
          icon: <Building2Icon size={16} />,
        },
        {
          id: 'admin-classes',
          label: 'Classes Workspace',
          to: '/rep',
          match: (p) => p.startsWith('/rep'),
          icon: <BookOpenIcon size={16} />,
        },
        {
          id: 'admin-audit',
          label: 'Anti-Proxy & Device Audit',
          to: '/admin?tab=audit',
          match: (p, sp) => p === '/admin' && sp.get('tab') === 'audit',
          icon: <ShieldCheckIcon size={16} />,
        },
      ];
    }

    if (role === 'rep') {
      return [
        {
          id: 'rep-classes',
          label: 'All Classes / Cohorts',
          to: '/rep?tab=directory',
          match: (p, sp) => p === '/rep' && (!sp.get('tab') || sp.get('tab') === 'directory'),
          icon: <LayoutDashboardIcon size={16} />,
        },
        {
          id: 'rep-new-class',
          label: 'Create New Class',
          to: '/rep?tab=create',
          match: (p, sp) => p === '/rep' && sp.get('tab') === 'create',
          icon: <PlusIcon size={16} />,
        },
        {
          id: 'rep-defaulters',
          label: 'Defaulters Watchlist (<75%)',
          to: '/rep?tab=defaulters',
          match: (p, sp) => p === '/rep' && sp.get('tab') === 'defaulters',
          icon: <AlertCircleIcon size={16} />,
        },
        {
          id: 'rep-audit',
          label: 'Device & Anti-Proxy Audit',
          to: '/rep?tab=audit',
          match: (p, sp) => p === '/rep' && sp.get('tab') === 'audit',
          icon: <ShieldCheckIcon size={16} />,
        },
        {
          id: 'rep-guide',
          label: 'Operations Guide',
          to: '/rep?tab=guide',
          match: (p, sp) => p === '/rep' && sp.get('tab') === 'guide',
          icon: <GraduationCapIcon size={16} />,
        },
      ];
    }

    if (role === 'student') {
      return [
        {
          id: 'student-live',
          label: 'Live Check-In',
          to: '/me?tab=live',
          match: (p, sp) => p === '/me' && (!sp.get('tab') || sp.get('tab') === 'live'),
          icon: <ClipboardCheckIcon size={16} />,
        },
        {
          id: 'student-history',
          label: 'Attendance History',
          to: '/me?tab=history',
          match: (p, sp) => p === '/me' && sp.get('tab') === 'history',
          icon: <CalendarDaysIcon size={16} />,
        },
        {
          id: 'student-device',
          label: 'My Passkey & Device',
          to: '/me?tab=device',
          match: (p, sp) => p === '/me' && sp.get('tab') === 'device',
          icon: <KeyRoundIcon size={16} />,
        },
        {
          id: 'student-profile',
          label: 'My Profile',
          to: '/me?tab=profile',
          match: (p, sp) => p === '/me' && sp.get('tab') === 'profile',
          icon: <GraduationCapIcon size={16} />,
        },
      ];
    }

    return [];
  }, [role]);

  const classSubNav = useMemo<NavEntry[]>(() => {
    if (!activeClassId) return [];
    const base = `/rep/class/${activeClassId}`;
    return [
      {
        id: 'cls-sessions',
        label: 'Lecture Sessions',
        to: base,
        match: (p) => p === base || p === `${base}/sessions`,
        icon: <ClipboardCheckIcon size={16} />,
      },
      {
        id: 'cls-students',
        label: 'Student Roster & Claims',
        to: `${base}/students`,
        match: (p) => p === `${base}/students`,
        icon: <UsersIcon size={16} />,
      },
      {
        id: 'cls-analytics',
        label: '75% Eligibility & Stats',
        to: `${base}/analytics`,
        match: (p) => p === `${base}/analytics`,
        icon: <AwardIcon size={16} />,
      },
      {
        id: 'cls-export',
        label: 'Export Attendance Matrix',
        to: `${base}/export`,
        match: (p) => p === `${base}/export`,
        icon: <FileSpreadsheetIcon size={16} />,
      },
      {
        id: 'cls-settings',
        label: 'Class Settings',
        to: `${base}/settings`,
        match: (p) => p === `${base}/settings`,
        icon: <SettingsIcon size={16} />,
      },
    ];
  }, [activeClassId]);

  const commands = useMemo<CommandItem[]>(() => {
    const list: CommandItem[] = primaryNav.map((n) => ({
      id: n.id,
      label: n.label,
      group: role === 'super_admin' ? 'Super Admin' : role === 'rep' ? 'Class Rep' : 'Student',
      to: n.to,
    }));
    for (const c of classSubNav) {
      list.push({
        id: c.id,
        label: `${activeClass?.name ?? 'Class'}: ${c.label}`,
        group: 'Active Class',
        to: c.to,
      });
    }
    for (const cl of userClasses) {
      list.push({
        id: `switch-class-${cl.id}`,
        label: `Switch to ${cl.name} (${cl.level || cl.join_code})`,
        group: 'Switch Class',
        action: () => handleSwitchClass(cl.id),
      });
    }
    if (role) {
      list.push({
        id: 'cmd-signout',
        label: 'Sign out of CampusPulse',
        group: 'Account',
        action: () => void handleSignOut(),
      });
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [primaryNav, classSubNav, role, userClasses, activeClass]);

  const userDisplayName =
    profile?.full_name ||
    (typeof user?.user_metadata?.full_name === 'string' && user.user_metadata.full_name) ||
    user?.email ||
    'Student Device';
  const initials = getInitials(userDisplayName || 'CP');

  // Public / Marketing / Auth shell
  if (!showSaasSidebar) {
    const onAuthPage =
      location.pathname.startsWith('/student/login') ||
      location.pathname.startsWith('/rep/login') ||
      location.pathname.startsWith('/admin/');
    return (
      <div className="shell">
        <header className="topbar">
          <div className="container topbar-inner">
            <div className="row">
              <Link to={homePath} className="brand">
                <span className="brand-icon" aria-hidden="true">
                  <ActivityIcon size={16} />
                </span>
                <span className="brand-text-wrap">
                  <span className="brand-title">CampusPulse</span>
                  <span className="brand-sub">UNIVERSITY PLATFORM</span>
                </span>
              </Link>
            </div>
            {role ? (
              <div className="topbar-user">
                <Link to={homePath} className="btn btn-primary btn-sm">
                  <span>Open Workspace →</span>
                </Link>
                <button className="link-button" onClick={handleSignOut}>
                  Sign out
                </button>
              </div>
            ) : (
              !onAuthPage && (
                <div className="topbar-user">
                  <Link to="/student/login" className="topbar-link">
                    Student Sign In
                  </Link>
                  <Link to="/rep/login" className="topbar-link">
                    Class Rep Sign In
                  </Link>
                  <Link to="/admin/login" className="btn btn-secondary btn-sm">
                    <span>Super Admin</span>
                  </Link>
                </div>
              )
            )}
          </div>
        </header>
        <main className="main">{children}</main>
      </div>
    );
  }

  // Full SaaS Vertical-Sidebar Application Layout (Figma UI Upgrade Reference)
  return (
    <div className="saas-layout">
      {mobileMenuOpen && (
        <div
          className="saas-backdrop"
          onClick={() => setMobileMenuOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside className={`saas-sidebar ${mobileMenuOpen ? 'is-open' : ''}`} aria-label="Primary Sidebar">
        <div className="saas-sidebar-top">
          <div className="saas-brand-row">
            <Link to={homePath} className="saas-brand" onClick={() => setMobileMenuOpen(false)}>
              <span className="saas-brand-mark" aria-hidden="true">
                <ActivityIcon size={17} />
              </span>
              <div className="saas-brand-text">
                <span className="saas-brand-name">CampusPulse</span>
                <span className="saas-brand-role">UNIVERSITY PLATFORM</span>
              </div>
            </Link>
            <button
              type="button"
              className="saas-sidebar-close"
              onClick={() => setMobileMenuOpen(false)}
              aria-label="Close navigation menu"
            >
              <XIcon size={16} />
            </button>
          </div>

          {/* Workspace / Active Class Switcher Card */}
          {(role === 'rep' || role === 'super_admin') && userClasses.length > 0 ? (
            <div className="saas-workspace-card">
              <div className="saas-workspace-head">
                <span className="saas-workspace-mark" aria-hidden="true">
                  {getInitials(activeClass?.name ?? 'CS')}
                </span>
                <div className="saas-workspace-meta">
                  <span className="saas-selector-label">ACTIVE COHORT</span>
                  <strong className="saas-workspace-name">
                    {activeClass?.name ?? 'Select class'}
                  </strong>
                </div>
                <ChevronDownIcon size={14} className="muted" />
              </div>
              <select
                className="saas-selector-select"
                value={activeClassId ?? ''}
                onChange={(e) => handleSwitchClass(e.target.value)}
                aria-label="Select active class"
              >
                {userClasses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} {c.level ? `(${c.level})` : ''}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="saas-workspace-card">
              <div className="saas-workspace-head">
                <span className="saas-workspace-mark" aria-hidden="true">
                  {role === 'super_admin' ? 'SA' : role === 'rep' ? 'CR' : 'ST'}
                </span>
                <div className="saas-workspace-meta">
                  <span className="saas-selector-label">ACTIVE PORTAL</span>
                  <strong className="saas-workspace-name">
                    {role === 'super_admin'
                      ? 'Super Admin Suite'
                      : role === 'rep'
                        ? profile?.level
                          ? `Class Rep · ${profile.level}`
                          : 'Class Rep Suite'
                        : 'Student Attendance'}
                  </strong>
                </div>
              </div>
            </div>
          )}

          <button
            type="button"
            className="saas-cmd-trigger"
            onClick={() => {
              setMobileMenuOpen(false);
              setCmdOpen(true);
            }}
            title="Quick Jump (Ctrl+K)"
          >
            <span className="row" style={{ gap: '0.45rem' }}>
              <SearchIcon size={14} />
              <span>Quick jump…</span>
            </span>
            <kbd>⌘K</kbd>
          </button>
        </div>

        <div className="saas-sidebar-scroll">
          {/* Class Management Tabs (if an active class is selected) */}
          {classSubNav.length > 0 && (
            <div className="saas-nav-group">
              <span className="saas-nav-title">
                {activeClass ? `${activeClass.name.toUpperCase()}` : 'CLASS MANAGEMENT'}
              </span>
              <nav className="saas-vnav" aria-label="Active class navigation">
                {classSubNav.map((item) => {
                  const active = item.match(location.pathname, searchParams);
                  return (
                    <Link
                      key={item.id}
                      to={item.to}
                      onClick={() => setMobileMenuOpen(false)}
                      className={`saas-vnav-link ${active ? 'is-active' : ''}`}
                    >
                      <span className="saas-vnav-icon" aria-hidden="true">
                        {item.icon}
                      </span>
                      <span className="saas-vnav-label">{item.label}</span>
                      {item.badge && <span className="saas-vnav-badge">{item.badge}</span>}
                      {active && <span className="saas-vnav-indicator" aria-hidden="true" />}
                    </Link>
                  );
                })}
              </nav>
            </div>
          )}

          <div className="saas-nav-group">
            <span className="saas-nav-title">
              {role === 'super_admin'
                ? 'ADMINISTRATION'
                : role === 'rep'
                  ? 'REP WORKSPACE'
                  : 'STUDENT PORTAL'}
            </span>
            <nav className="saas-vnav" aria-label="Workspace navigation">
              {primaryNav.map((item) => {
                const active = item.match(location.pathname, searchParams);
                return (
                  <Link
                    key={item.id}
                    to={item.to}
                    onClick={() => setMobileMenuOpen(false)}
                    className={`saas-vnav-link ${active ? 'is-active' : ''}`}
                  >
                    <span className="saas-vnav-icon" aria-hidden="true">
                      {item.icon}
                    </span>
                    <span className="saas-vnav-label">{item.label}</span>
                    {item.badge && <span className="saas-vnav-badge">{item.badge}</span>}
                    {active && <span className="saas-vnav-indicator" aria-hidden="true" />}
                  </Link>
                );
              })}
            </nav>
          </div>
        </div>

        <div className="saas-sidebar-footer">
          <div className="saas-help-card">
            <span className="saas-help-icon" aria-hidden="true">
              {role === 'student' ? <SmartphoneIcon size={15} /> : <ShieldCheckIcon size={15} />}
            </span>
            <strong>
              {role === 'student' ? '1 Phone = 1 Student' : 'Verified Attendance'}
            </strong>
            <p>
              {role === 'student'
                ? 'Hardware WebAuthn passkey & GPS geofence protection active.'
                : 'GPS geofencing, Passkey hardware lock & 75% NUC eligibility.'}
            </p>
          </div>

          <div className="saas-user-card">
            <div className="saas-avatar" aria-hidden="true">
              {initials}
            </div>
            <div className="saas-user-meta">
              <strong className="saas-user-name">
                {userDisplayName}
              </strong>
              <span className="saas-user-sub">
                {user?.email || (role === 'student' ? 'Biometric Passkey Linked' : '')}
              </span>
            </div>
            <button
              type="button"
              className="saas-signout-icon-btn"
              onClick={handleSignOut}
              title="Sign out"
              aria-label="Sign out"
            >
              <LogOutIcon size={15} />
            </button>
          </div>
        </div>
      </aside>

      <div className="saas-workspace">
        <header className="saas-topbar">
          <div className="saas-topbar-left">
            <button
              type="button"
              className="saas-menu-btn"
              onClick={() => setMobileMenuOpen((v) => !v)}
              aria-label="Toggle navigation menu"
            >
              <MenuIcon size={17} />
              <span>Menu</span>
            </button>
            <div className="saas-breadcrumbs">
              <span className="saas-breadcrumb-root">CampusPulse</span>
              <ChevronRightIcon size={13} className="saas-breadcrumb-sep" />
              <strong className="saas-breadcrumb-current">
                {role === 'super_admin'
                  ? 'Super Admin Console'
                  : role === 'rep'
                    ? activeClass
                      ? activeClass.name
                      : 'Classes Workspace'
                    : 'Student Attendance'}
              </strong>
            </div>
          </div>

          <div className="saas-topbar-right">
            <span className="saas-status-pill">
              <span className="saas-status-dot" />
              <span className="saas-status-text">Live Sync</span>
            </span>
            {role === 'super_admin' && <Badge tone="ok">Super Admin</Badge>}
            {role === 'rep' && profile?.level && <Badge tone="neutral">{profile.level}</Badge>}
            <button
              type="button"
              className="btn btn-secondary btn-sm saas-search-btn"
              onClick={() => setCmdOpen(true)}
            >
              <SearchIcon size={13} />
              <span>Search / ⌘K</span>
            </button>
            <span className="saas-top-avatar" aria-hidden="true">
              {initials}
            </span>
          </div>
        </header>

        <main className="saas-main">{children}</main>

        <nav className="saas-mobile-bottomnav" aria-label="Mobile quick navigation">
          {(classSubNav.length > 0 ? classSubNav : primaryNav).slice(0, 4).map((item) => {
            const active = item.match(location.pathname, searchParams);
            return (
              <Link
                key={item.id}
                to={item.to}
                onClick={() => setMobileMenuOpen(false)}
                className={`saas-mobile-tab ${active ? 'is-active' : ''}`}
              >
                <span className="saas-mobile-tab-icon" aria-hidden="true">
                  {item.icon}
                </span>
                <span className="saas-mobile-tab-label">{item.label}</span>
              </Link>
            );
          })}
          <button
            type="button"
            className={`saas-mobile-tab ${mobileMenuOpen ? 'is-active' : ''}`}
            onClick={() => setMobileMenuOpen((v) => !v)}
          >
            <span className="saas-mobile-tab-icon" aria-hidden="true">
              <MenuIcon size={16} />
            </span>
            <span className="saas-mobile-tab-label">More</span>
          </button>
        </nav>
      </div>

      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} items={commands} />
    </div>
  );
}
