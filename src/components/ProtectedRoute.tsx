import { useAuth } from '../contexts/AuthContext';
import type { UserRole } from '../api/client';

export function ProtectedRoute({
  children,
  roles,
}: {
  children: React.ReactNode;
  roles?: UserRole[];
}) {
  const { user, loading, error } = useAuth();

  // Se está carregando, mostrar spinner
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  // Se tem erro de autenticação
  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="text-red-600 mb-2">Erro de autenticação</div>
          <div className="text-gray-600 text-sm">{error}</div>
        </div>
      </div>
    );
  }

  // Se não tem usuário, mostrar tela de login
  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="text-gray-600 mb-2">Não autenticado</div>
          <div className="text-gray-500 text-sm">Por favor, faça login para continuar</div>
        </div>
      </div>
    );
  }

  // Verificar roles se especificado
  if (roles && roles.length > 0 && !roles.includes(user.role)) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="text-red-600 mb-2">Acesso negado</div>
          <div className="text-gray-600 text-sm">Você não tem permissão para acessar esta página</div>
        </div>
      </div>
    );
  }

  // Se chegou aqui, pode renderizar
  return <>{children}</>;
}
