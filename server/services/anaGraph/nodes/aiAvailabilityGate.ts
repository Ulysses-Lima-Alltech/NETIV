import { resolveAiSettingsForEnterprise } from '../../enterpriseAiSettingsService.js';
import type { AnaGraphState } from '../state.js';

const DEFAULT_EMERGENCY_BLOCK_MESSAGE =
  'No momento este empreendimento esta com atendimento automatico temporariamente bloqueado.';

/**
 * Espelha o gate de disponibilidade de IA por empreendimento que hoje só
 * existe em conversationEngine.ts (resolveAiSettingsForEnterprise + bloco
 * de blockedReason, ~linha 6166) -- sem isso, os toggles da tela de
 * Settings > Configuração de API (enterprise_ai_settings: "Bloqueio
 * emergencial ativo", "IA ativa neste empreendimento") não tinham nenhum
 * efeito nos empreendimentos rodando no grafo novo: automationGateNode só
 * checa handoff, nunca essas flags. Reportado em produção: ativar/
 * desativar o bloqueio emergencial do Évora não mudava o comportamento da
 * Ana, porque o Évora já estava na allowlist de produção do grafo (o
 * motor legado, que respeita esse gate, nunca chegava a rodar).
 *
 * Roda logo após resolveEnterpriseNode (precisa de state.enterpriseId).
 */
export async function aiAvailabilityGateNode(state: AnaGraphState): Promise<Partial<AnaGraphState>> {
  if (state.enterpriseId == null) {
    return { aiBlocked: false, aiBlockedReplyText: null };
  }

  const resolved = await resolveAiSettingsForEnterprise(state.enterpriseId);
  if (!resolved.blocked) {
    return { aiBlocked: false, aiBlockedReplyText: null };
  }

  // Mesma distinção do motor legado: configuração de modelo ausente/inválida
  // fica em silêncio (não manda mensagem confusa pro cliente por causa de um
  // problema de configuração interno); os demais motivos mandam uma resposta
  // fixa em vez de rodar o LLM.
  if (resolved.reason === 'ana_model_not_configured') {
    return { aiBlocked: true, aiBlockedReplyText: null };
  }

  const replyText =
    resolved.reason === 'emergency_block'
      ? resolved.blockedMessage ?? DEFAULT_EMERGENCY_BLOCK_MESSAGE
      : resolved.reason === 'ai_disabled'
        ? 'No momento o atendimento automatico deste empreendimento esta desativado. Vou direcionar voce para um corretor.'
        : resolved.reason === 'missing_enterprise_api_key'
          ? 'No momento a configuracao de IA deste empreendimento esta incompleta. Vou direcionar voce para um corretor.'
          : 'No momento a configuracao global de IA esta indisponivel. Vou direcionar voce para um corretor.';

  return { aiBlocked: true, aiBlockedReplyText: replyText };
}
