import { lazy, Suspense, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '@/hooks/useAuth';
import { ToastProvider } from '@/hooks/useToast';
import { isConfigured } from '@/lib/supabase';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Shell } from '@/components/Shell';
import { RequireRep, RequireSuperAdmin } from '@/components/RequireRep';
import { PageLoader } from '@/components/ui';
import { SetupRequired } from '@/pages/SetupRequired';
import { Landing } from '@/pages/Landing';
import { NotFound } from '@/pages/NotFound';

// Student pages are small and loaded eagerly so the check-in path is fast.
import { JoinPage } from '@/pages/student/JoinPage';
import { StudentHome } from '@/pages/student/StudentHome';

// Staff pages are split out; students never download them.
const RepAuthPage = lazy(() => import('@/pages/rep/RepAuthPage'));
const AdminAuthPage = lazy(() => import('@/pages/admin/AdminAuthPage'));
const AdminPasswordRecoveryPage = lazy(() => import('@/pages/admin/AdminPasswordRecoveryPage'));
const AdminPage = lazy(() => import('@/pages/admin/AdminPage'));
const ClassesPage = lazy(() => import('@/pages/rep/ClassesPage'));
const ClassPage = lazy(() => import('@/pages/rep/ClassPage'));
const NewSessionPage = lazy(() => import('@/pages/rep/NewSessionPage'));
const LiveSessionPage = lazy(() => import('@/pages/rep/LiveSessionPage'));

export default function App() {
  const [configured, setConfigured] = useState(isConfigured);
  if (!configured) return <SetupRequired onConfigured={() => setConfigured(true)} />;

  return (
    <ErrorBoundary>
      <AuthProvider>
        <ToastProvider>
          <BrowserRouter>
            <Shell>
              <Suspense fallback={<PageLoader />}>
                <Routes>
                  <Route path="/" element={<Landing />} />
                  <Route path="/join" element={<JoinPage />} />
                  <Route path="/join/:code" element={<JoinPage />} />
                  <Route path="/me" element={<StudentHome />} />

                  <Route path="/rep/login" element={<RepAuthPage />} />
                  <Route path="/rep/signup" element={<Navigate to="/rep/login" replace />} />

                  <Route path="/admin/login" element={<AdminAuthPage initialTab="signin" />} />
                  <Route path="/admin/forgot-password" element={<AdminPasswordRecoveryPage mode="request" />} />
                  <Route path="/admin/reset-password" element={<AdminPasswordRecoveryPage mode="reset" />} />
                  <Route path="/admin/setup" element={<AdminAuthPage initialTab="setup" />} />

                  <Route element={<RequireSuperAdmin />}>
                    <Route path="/admin" element={<AdminPage />} />
                  </Route>

                  <Route element={<RequireRep />}>
                    <Route path="/rep" element={<ClassesPage />} />
                    <Route path="/rep/class/:classId/new-session" element={<NewSessionPage />} />
                    <Route path="/rep/class/:classId/:tab?" element={<ClassPage />} />
                    <Route path="/rep/session/:sessionId" element={<LiveSessionPage />} />
                  </Route>

                  <Route path="/home" element={<Navigate to="/" replace />} />
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </Suspense>
            </Shell>
          </BrowserRouter>
        </ToastProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}
