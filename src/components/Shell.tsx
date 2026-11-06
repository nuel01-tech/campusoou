import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/useToast';
import { signOut } from '@/services/auth';
import { listClasses } from '@/services/classes';
import { toAppError } from '@/lib/errors';
import { Badge } from './ui';
import { CommandPalette, type CommandItem } from './saas';
import type { ClassRoom } from '@/types';

interface NavEntry {
  id: string;
  label: string;
  to: string;
  match: (pathname: string, searchParams: URLSearchParams) => boolean;
  badge?: string;
  icon?: string;
}

const ACTIVE_CLASS_KEY = 'campuspulse_active_class_id';

export function Shell({ children }: { children: ReactNode }) {
  const { role, profile, user } = useAuth();
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
        },
        {
          id: 'admin-live',
          label: 'Live Campus Sessions',
          to: '/admin?tab=live-sessions',
          match: (p, sp) => p === '/admin' && sp.get('tab') === 'live-sessions',
          badge: 'Live',
        },
        {
          id: 'admin-defaulters',
          label: 'Defaulters Watchlist (<75%)',
          to: '/admin?tab=defaulters',
          match: (p, sp) => p === '/admin' && sp.get('tab') === 'defaulters',
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
          badge: '+',
        },
        {
          id: 'admin-depts',
          label: 'Departments Manager',
          to: '/admin?tab=departments',
          match: (p, sp) => p === '/admin' && sp.get('tab') === 'departments',
        },
        {
          id: 'admin-classes',
          label: 'Classes Workspace',
          to: '/rep',
          match: (p) => p.startsWith('/rep'),
        },
        {
          id: 'admin-audit',
          label: 'Anti-Proxy & Device Audit',
          to: '/admin?tab=audit',
          match: (p, sp) => p === '/admin' && sp.get('tab') === 'audit',
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
        },
        {
          id: 'rep-new-class',
          label: 'Create New Class',
          to: '/rep?tab=create',
          match: (p, sp) => p === '/rep' && sp.get('tab') === 'create',
          badge: '+',
        },
        {
          id: 'rep-defaulters',
          label: 'Defaulters Watchlist (<75%)',
          to: '/rep?tab=defaulters',
          match: (p, sp) => p === '/rep' && sp.get('tab') === 'defaulters',
        },
        {
          id: 'rep-audit',
          label: 'Device & Anti-Proxy Audit',
          to: '/rep?tab=audit',
          match: (p, sp) => p === '/rep' && sp.get('tab') === 'audit',
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
  }, [role, activeClassId]);

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
        label: 'Student Roster & Claims',
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
        label: 'Export Attendance Matrix',
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
          <div className="saas-brand-row">
            <Link to={homePath} className="saas-brand" onClick={() => setMobileMenuOpen(false)}>
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
              className="saas-sidebar-close"
              onClick={() => setMobileMenuOpen(false)}
              aria-label="Close navigation menu"
            >
              ✕
            </button>
          </div>

          {/* Quick Class Context Selector for Class Reps & Admins */}
          {(role === 'rep' || role === 'super_admin') && userClasses.length > 0 && (
            <div className="saas-class-selector">
              <span className="saas-selector-label">ACTIVE CLASS:</span>
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
            <span>Quick jump…</span>
            <kbd>⌘K</kbd>
          </button>
        </div>

        <div className="saas-sidebar-scroll">
          {/* Class Management Tabs (if an active class is selected) */}
          {classSubNav.length > 0 && (
            <div className="saas-nav-group">
              <span className="saas-nav-title">
                {activeClass ? `${activeClass.name.toUpperCase()} TABS` : 'CLASS MANAGEMENT'}
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
                      <span className="saas-vnav-dot" aria-hidden="true" />
                      <span className="saas-vnav-label">{item.label}</span>
                      {item.badge && <span className="saas-vnav-badge">{item.badge}</span>}
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
                    <span className="saas-vnav-dot" aria-hidden="true" />
                    <span className="saas-vnav-label">{item.label}</span>
                    {item.badge && <span className="saas-vnav-badge">{item.badge}</span>}
                  </Link>
                );
              })}
            </nav>
          </div>
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
              <span className="muted small saas-breadcrumb-root">CampusPulse /</span>
              <strong className="small saas-breadcrumb-current">
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
              <span>Search / ⌘K</span>
            </button>
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
                <span className="saas-mobile-tab-dot" aria-hidden="true" />
                <span className="saas-mobile-tab-label">{item.label}</span>
              </Link>
            );
          })}
          <button
            type="button"
            className={`saas-mobile-tab ${mobileMenuOpen ? 'is-active' : ''}`}
            onClick={() => setMobileMenuOpen((v) => !v)}
          >
            <span className="saas-mobile-tab-dot" aria-hidden="true" />
            <span className="saas-mobile-tab-label">More</span>
          </button>
        </nav>
      </div>

      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} items={commands} />
    </div>
  );
}
