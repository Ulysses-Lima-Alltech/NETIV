import type { UserRole } from '../api/client';

/** Bypass temporário: mantém a mesma API (children, roles) mas não bloqueia acesso. */
export function ProtectedRoute({
  children,
  roles: _roles,
}: {
  children: React.ReactNode;
  roles?: UserRole[];
}) {
  return <>{children}</>;
}
