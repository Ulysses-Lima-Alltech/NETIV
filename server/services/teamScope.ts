import type { AppUser } from '../repositories/userRepository.js';

/**
 * Filtros que aceitam ser restringidos por escopo de equipe.
 * Qualquer rota que liste registros com enterprise_id implementa essa interface.
 */
export interface ScopableFilters {
  allowedEnterpriseIds?: number[];
}

/**
 * Lê a feature flag TEAM_SCOPE_ENFORCED.
 * Aceita: '1', 'true', 'yes', 'on' (case-insensitive). Qualquer outra coisa = false.
 */
export function isTeamScopeEnforced(): boolean {
  const raw = String(process.env.TEAM_SCOPE_ENFORCED ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

/**
 * Aplica o filtro de escopo no objeto `filters`, in-place.
 *
 * - Flag desligada → não faz nada.
 * - Usuário com scope_kind='all' (admin) → não faz nada.
 * - Caso contrário → seta filters.allowedEnterpriseIds com a lista do usuário.
 *
 * Importante: se a lista vier vazia, o filtro vira "FALSE" no SQL (ninguém vê nada).
 * Isso é intencional para a regra "sem company → vê nada".
 */
export function applyTeamScope(filters: ScopableFilters, user: AppUser): void {
  if (!isTeamScopeEnforced()) return;
  if (user.scope_kind === 'all') return;
  filters.allowedEnterpriseIds = Array.isArray(user.allowed_enterprise_ids)
    ? user.allowed_enterprise_ids
    : [];
}
