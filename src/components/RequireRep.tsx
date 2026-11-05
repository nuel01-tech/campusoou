import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { PageLoader } from './ui';

export function RequireRep() {
  const { ready, role } = useAuth();
  const location = useLocation();
  if (!ready) return <PageLoader />;
  if (role !== 'rep' && role !== 'super_admin') {
    return <Navigate to="/rep/login" replace state={{ from: location.pathname }} />;
  }
  return <Outlet />;
}

export function RequireSuperAdmin() {
  const { ready, role } = useAuth();
  const location = useLocation();
  if (!ready) return <PageLoader />;
  if (role === 'rep') return <Navigate to="/rep" replace />;
  if (role !== 'super_admin') {
    return <Navigate to="/admin/login" replace state={{ from: location.pathname }} />;
  }
  return <Outlet />;
}
