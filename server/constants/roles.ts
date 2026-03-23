/** Valores persistidos em app_users.role (alinhado ao CHECK da migração 015). */
export const ALL_APP_USER_ROLES = ['ADMIN', 'COLLABORATOR', 'MANAGERIAL'] as const;

export type UserRole = (typeof ALL_APP_USER_ROLES)[number];

export function isUserRole(s: string): s is UserRole {
  return ALL_APP_USER_ROLES.some((r) => r === s);
}

/** Admin e gerencial: mesmas telas/ações, exceto configurações de integrações/IA (apenas ADMIN). */
export const ROLES_ORG_ADMIN: readonly UserRole[] = ['ADMIN', 'MANAGERIAL'];

/** Apenas administrador total (integrações, IA, WhatsApp na API). */
export const ROLES_SETTINGS_ADMIN: readonly UserRole[] = ['ADMIN'];
