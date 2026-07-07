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
      <div className="flex items-center justify-center min-h-screen bg-[#F9FAFB] px-4">
        <div className="flex flex-col items-center gap-3 rounded-[14px] border border-[#E5E7EB] bg-white px-6 py-8 text-center shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#3B82F6] border-t-transparent" />
          <div>
            <p className="text-[14px] font-medium text-[#111827]">Sincronizando acesso...</p>
            <p className="mt-1 max-w-[280px] text-[13px] text-[#6B7280]">
              Estamos aguardando o SSO concluir o carregamento antes de abrir a inbox.
            </p>
          </div>
        </div>
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
