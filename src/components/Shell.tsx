import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/useToast';
import { signOut } from '@/services/auth';
import { toAppError } from '@/lib/errors';
import { Badge } from './ui';
import { CommandPalette, type CommandItem } from './saas';

interface NavEntry {
  id: string;
  label: string;
  to: string;
  match: (pathname: string, searchParams: URLSearchParams) => boolean;
  badge?: string;
}

export function Shell({ children }: { children: ReactNode }) {
  const { role, profile, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const toast = useToast();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);

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
    try {
      await signOut();
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
    location.pathname.startsWith('/rep/login') ||
    location.pathname.startsWith('/admin/login') ||
    location.pathname.startsWith('/admin/setup') ||
    location.pathname.startsWith('/admin/forgot-password') ||
    location.pathname.startsWith('/admin/reset-password');

  const showSaasSidebar = Boolean(role) && !onPublicOrAuthPage;

  // Extract current classId if viewing a specific class
  const classMatch = /^\/rep\/class\/([^/]+)/.exec(location.pathname);
  const activeClassId = classMatch ? classMatch[1] : null;

  const primaryNav = useMemo<NavEntry[]>(() => {
    if (role === 'super_admin') {
      return [
        {
          id: 'admin-overview',
          label: 'Overview & KPIs',
          to: '/admin?tab=overview',
          match: (p, sp) => p === '/admin' && (!sp.get('tab') || sp.get('tab') === 'overview'),
        },
        {
          id: 'admin-reps',
          label: 'Class Rep Directory',
          to: '/admin?tab=reps',
          match: (p, sp) => p === '/admin' && sp.get('tab') === 'reps',
        },
        {
          id: 'admin-create',
          label: 'Provision Class Rep',
          to: '/admin?tab=create',
          match: (p, sp) => p === '/admin' && sp.get('tab') === 'create',
          badge: 'New',
        },
        {
          id: 'admin-depts',
          label: 'Departments',
          to: '/admin?tab=departments',
          match: (p, sp) => p === '/admin' && sp.get('tab') === 'departments',
        },
        {
          id: 'admin-classes',
          label: 'Classes Workspace',
          to: '/rep',
          match: (p) => p.startsWith('/rep'),
        },
      ];
    }

    if (role === 'rep') {
      return [
        {
          id: 'rep-classes',
          label: 'All Classes',
          to: '/rep?tab=directory',
          match: (p, sp) => p === '/rep' && (!sp.get('tab') || sp.get('tab') === 'directory'),
        },
        {
          id: 'rep-new-class',
          label: 'Create New Class',
          to: '/rep?tab=create',
          match: (p, sp) => p === '/rep' && sp.get('tab') === 'create',
          badge: '+',
        },
        {
          id: 'rep-guide',
          label: 'Operations Guide',
          to: '/rep?tab=guide',
          match: (p, sp) => p === '/rep' && sp.get('tab') === 'guide',
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
        },
        {
          id: 'student-history',
          label: 'Attendance History',
          to: '/me?tab=history',
          match: (p, sp) => p === '/me' && sp.get('tab') === 'history',
        },
        {
          id: 'student-device',
          label: 'My Passkey & Device',
          to: '/me?tab=device',
          match: (p, sp) => p === '/me' && sp.get('tab') === 'device',
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
      },
      {
        id: 'cls-students',
        label: 'Student Roster',
        to: `${base}/students`,
        match: (p) => p === `${base}/students`,
      },
      {
        id: 'cls-analytics',
        label: '75% Eligibility & Stats',
        to: `${base}/analytics`,
        match: (p) => p === `${base}/analytics`,
      },
      {
        id: 'cls-export',
        label: 'Export Attendance',
        to: `${base}/export`,
        match: (p) => p === `${base}/export`,
      },
      {
        id: 'cls-settings',
        label: 'Class Settings',
        to: `${base}/settings`,
        match: (p) => p === `${base}/settings`,
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
        label: c.label,
        group: 'Active Class',
        to: c.to,
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
  }, [primaryNav, classSubNav, role]);

  const initials = (profile?.full_name || user?.email || 'CP')
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]!.toUpperCase())
    .join('');

  // Public / Marketing / Auth shell
  if (!showSaasSidebar) {
    const onAuthPage =
      location.pathname.startsWith('/rep/login') || location.pathname.startsWith('/admin/');
    return (
      <div className="shell">
        <header className="topbar">
          <div className="container topbar-inner">
            <div className="row">
              <Link to={homePath} className="brand">
                <span className="brand-mark" aria-hidden="true" />
                CampusPulse
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
                  <Link to="/rep/login" className="topbar-link">
                    Rep Sign In
                  </Link>
                  <Link to="/admin/login" className="btn btn-secondary btn-sm">
                    <span>Admin</span>
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

  // Full SaaS Vertical-Sidebar Application Layout
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
          <Link to={homePath} className="saas-brand">
            <span className="saas-brand-mark" aria-hidden="true">
              CP
            </span>
            <div className="saas-brand-text">
              <span className="saas-brand-name">CampusPulse</span>
              <span className="saas-brand-role">
                {role === 'super_admin'
                  ? 'Super Admin Suite'
                  : role === 'rep'
                    ? profile?.level
                      ? `Class Rep · ${profile.level}`
                      : 'Class Rep Suite'
                    : 'Student Portal'}
              </span>
            </div>
          </Link>

          <button
            type="button"
            className="saas-cmd-trigger"
            onClick={() => setCmdOpen(true)}
            title="Quick Jump (Ctrl+K)"
          >
            <span>Quick jump…</span>
            <kbd>⌘K</kbd>
          </button>
        </div>

        <div className="saas-sidebar-scroll">
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
                    className={`saas-vnav-link ${active ? 'is-active' : ''}`}
                  >
                    <span className="saas-vnav-dot" aria-hidden="true" />
                    <span className="saas-vnav-label">{item.label}</span>
                    {item.badge && <span className="saas-vnav-badge">{item.badge}</span>}
                  </Link>
                );
              })}
            </nav>
          </div>

          {classSubNav.length > 0 && (
            <div className="saas-nav-group">
              <span className="saas-nav-title">ACTIVE CLASS TABS</span>
              <nav className="saas-vnav" aria-label="Active class navigation">
                {classSubNav.map((item) => {
                  const active = item.match(location.pathname, searchParams);
                  return (
                    <Link
                      key={item.id}
                      to={item.to}
                      className={`saas-vnav-link ${active ? 'is-active' : ''}`}
                    >
                      <span className="saas-vnav-dot" aria-hidden="true" />
                      <span className="saas-vnav-label">{item.label}</span>
                    </Link>
                  );
                })}
              </nav>
            </div>
          )}
        </div>

        <div className="saas-sidebar-footer">
          <div className="saas-user-card">
            <div className="saas-avatar" aria-hidden="true">
              {initials}
            </div>
            <div className="saas-user-meta">
              <strong className="saas-user-name">
                {profile?.full_name || user?.email || 'Student Device'}
              </strong>
              <span className="saas-user-sub">
                {user?.email || (role === 'student' ? 'Biometric Passkey Linked' : '')}
              </span>
            </div>
          </div>
          <button type="button" className="saas-signout-btn" onClick={handleSignOut}>
            Sign out
          </button>
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
              ☰ Menu
            </button>
            <div className="saas-breadcrumbs">
              <span className="muted small">CampusPulse</span>
              <span className="muted small">/</span>
              <strong className="small">
                {role === 'super_admin'
                  ? 'Super Admin Console'
                  : role === 'rep'
                    ? activeClassId
                      ? 'Class Management'
                      : 'Classes Workspace'
                    : 'Student Attendance'}
              </strong>
            </div>
          </div>

          <div className="saas-topbar-right">
            <span className="saas-status-pill">
              <span className="saas-status-dot" />
              Live Sync
            </span>
            {role === 'super_admin' && <Badge tone="ok">Super Admin</Badge>}
            {role === 'rep' && profile?.level && <Badge tone="neutral">{profile.level}</Badge>}
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setCmdOpen(true)}
            >
              <span>Search / Jump</span>
            </button>
          </div>
        </header>

        <main className="saas-main">{children}</main>
      </div>

      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} items={commands} />
    </div>
  );
}
