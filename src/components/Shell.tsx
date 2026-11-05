import type { ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/useToast';
import { signOut } from '@/services/auth';
import { toAppError } from '@/lib/errors';
import { Badge } from './ui';

export function Shell({ children }: { children: ReactNode }) {
  const { role, profile, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();

  const handleSignOut = async () => {
    try {
      await signOut();
      navigate('/', { replace: true });
    } catch (e) {
      toast(toAppError(e).message, 'error');
    }
  };

  const homePath = role === 'super_admin' ? '/admin' : role === 'rep' ? '/rep' : role === 'student' ? '/me' : '/';
  const isStaff = role === 'super_admin' || role === 'rep';
  const onAuthPage = location.pathname.startsWith('/rep/login') || location.pathname.startsWith('/admin/');

  return (
    <div className="shell">
      <header className="topbar">
        <div className="container topbar-inner">
          <div className="row">
            <Link to={homePath} className="brand">
              <span className="brand-mark" aria-hidden="true" />
              CampusPulse
            </Link>
            {role === 'super_admin' && (
              <nav className="topbar-nav" aria-label="Admin navigation">
                <NavLink to="/admin" end className={({ isActive }) => `topbar-link ${isActive ? 'is-active' : ''}`}>
                  Class Reps
                </NavLink>
                <NavLink to="/rep" className={({ isActive }) => `topbar-link ${isActive ? 'is-active' : ''}`}>
                  Classes
                </NavLink>
              </nav>
            )}
          </div>
          {isStaff ? (
            <div className="topbar-user">
              {role === 'super_admin' && <Badge tone="ok">Super Admin</Badge>}
              <span className="topbar-email">{profile?.full_name || user?.email}</span>
              <button className="link-button" onClick={handleSignOut}>
                Sign out
              </button>
            </div>
          ) : (
            !role &&
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
