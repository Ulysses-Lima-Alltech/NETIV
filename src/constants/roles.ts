import type { UserRole } from '../api/client';

/** Espelha server/constants/roles.ts — rotas e menu devem usar estes arrays para não divergir do backend. */
export const ROLES_ORG_ADMIN: readonly UserRole[] = ['ADMIN', 'MANAGERIAL'];

export const ROLES_SETTINGS_ADMIN: readonly UserRole[] = ['ADMIN'];
