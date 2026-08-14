/**
 * Gate de rollout controlado do grafo novo em produção (responde clientes
 * reais). Segue o mesmo padrão de flag boolean global via env já usado no
 * projeto (ANA_GRAPH_SHADOW_ENABLED, ANA_EMERGENCY_HANDOFF etc. — ver
 * utils/anaAutomationKillSwitch.ts), mais uma allowlist de enterpriseId
 * pra controlar o raio de impacto — não existia nenhum padrão de rollout
 * por empresa antes disso no projeto.
 *
 * Desligado por padrão nas duas camadas: precisa ANA_GRAPH_PRODUCTION_ENABLED=true
 * E o enterpriseId estar na allowlist (ANA_GRAPH_PRODUCTION_ENTERPRISE_IDS,
 * lista separada por vírgula) pra essa conversa ser atendida pelo grafo.
 * Sem a allowlist configurada, nenhuma empresa é ativada mesmo com o
 * master switch ligado — silêncio (nenhum enterpriseId) nunca é lido como
 * "todas".
 */
export function isAnaGraphProductionMasterEnabled(): boolean {
  return String(process.env.ANA_GRAPH_PRODUCTION_ENABLED ?? '').trim().toLowerCase() === 'true';
}

function parseEnterpriseIdAllowlist(): Set<number> {
  const raw = String(process.env.ANA_GRAPH_PRODUCTION_ENTERPRISE_IDS ?? '').trim();
  if (!raw) return new Set();
  return new Set(
    raw
      .split(',')
      .map((part) => Number.parseInt(part.trim(), 10))
      .filter((n) => Number.isFinite(n))
  );
}

export function isAnaGraphProductionEnabledForEnterprise(enterpriseId: number | null): boolean {
  if (!isAnaGraphProductionMasterEnabled()) return false;
  if (enterpriseId == null) return false;
  const allowlist = parseEnterpriseIdAllowlist();
  return allowlist.has(enterpriseId);
}
