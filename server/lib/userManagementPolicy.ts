import type { UserRole } from '../constants/roles.js';
import type { AppUser } from '../repositories/userRepository.js';

/** Corpo parcial de PATCH /users/:id (após validação Zod). */
export type PatchUserBody = {
  name?: string;
  email?: string;
  role?: UserRole;
  active?: boolean;
  brokerId?: number | null;
};

export class UserManagementPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserManagementPolicyError';
  }
}

/**
 * MANAGERIAL só pode criar COLLABORATOR.
 * ADMIN: sem restrição aqui.
 */
export function assertManagerialCanCreateUser(actorRole: UserRole, requestedRole: UserRole): void {
  if (actorRole !== 'MANAGERIAL') return;
  if (requestedRole !== 'COLLABORATOR') {
    throw new UserManagementPolicyError('Perfil gerencial só pode criar colaboradores.');
  }
}

/**
 * MANAGERIAL só pode alterar usuários cujo perfil atual é COLLABORATOR
 * e não pode definir outro perfil além de COLLABORATOR.
 */
export function assertManagerialCanUpdateUser(actorRole: UserRole, targetUser: AppUser, body: PatchUserBody): void {
  if (actorRole !== 'MANAGERIAL') return;
  if (targetUser.role !== 'COLLABORATOR') {
    throw new UserManagementPolicyError('Perfil gerencial só pode alterar contas de colaboradores.');
  }
  if (body.role !== undefined && body.role !== 'COLLABORATOR') {
    throw new UserManagementPolicyError('Perfil gerencial só pode manter o perfil Colaborador.');
  }
}

/**
 * MANAGERIAL só pode alterar senha de COLLABORATOR.
 */
export function assertManagerialCanChangePassword(actorRole: UserRole, targetUser: AppUser): void {
  if (actorRole !== 'MANAGERIAL') return;
  if (targetUser.role !== 'COLLABORATOR') {
    throw new UserManagementPolicyError('Perfil gerencial só pode alterar senha de colaboradores.');
  }
}
