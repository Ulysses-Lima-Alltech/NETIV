import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import type { UserRole } from '../api/client';

export function ProtectedRoute({ children, roles }: { children: React.ReactNode; roles?: UserRole[] }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F9FAFB]">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#3B82F6] border-t-transparent" aria-label="Carregando" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (user.mustChangePassword && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />;
  }
  if (!user.mustChangePassword && location.pathname === '/change-password') {
    return <Navigate to="/inbox" replace />;
  }
  if (roles?.length && !roles.includes(user.role)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F9FAFB] p-4">
        <div className="rounded-xl border border-red-100 bg-white p-6 text-center">
          <h1 className="text-base font-semibold text-red-700">Acesso negado</h1>
          <p className="mt-2 text-sm text-gray-600">Seu perfil não permite acessar esta página.</p>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
