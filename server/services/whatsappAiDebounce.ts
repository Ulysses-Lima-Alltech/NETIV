import { getTrailingUserMessageBurst } from '../repositories/messageRepository.js';
import { handleIncomingMessage } from './conversationEngine.js';
import {
  bumpConversationPipelineToken,
  getConversationPipelineToken,
} from './conversationPipelineToken.js';
import { getConversationById } from '../repositories/conversationRepository.js';
import { isAnaGraphProductionEnabledForEnterprise } from './anaGraph/productionRollout.js';
import { runAnaGraphProduction } from './anaGraph/productionRunner.js';

function phoneTail(raw: string, len = 6): string | null {
  const d = String(raw ?? '').replace(/\D/g, '');
  return d.length ? d.slice(-len) : null;
}

/**
 * Dispara processamento da IA imediatamente após salvar mensagem do usuário.
 * O pipeline token garante que uma mensagem nova cancele resposta pendente da anterior.
 */
export function scheduleWhatsAppAiAfterUserMessage(
  conversationId: number,
  toPhoneNumber: string,
  inboundMetaMessageId?: string | null
): void {
  const pipelineToken = bumpConversationPipelineToken(conversationId);
  console.log('[ANA_PIPELINE] debounce_start', {
    conversationId,
    pipelineToken,
    toPhoneTail: phoneTail(toPhoneNumber, 6),
    inboundMetaMessageId: inboundMetaMessageId ?? null,
  });
  void flushSingleMessage(conversationId, toPhoneNumber, pipelineToken, inboundMetaMessageId ?? null);
}

async function flushSingleMessage(
  conversationId: number,
  toPhoneNumber: string,
  pipelineToken: number,
  inboundMetaMessageId: string | null
): Promise<void> {
  try {
    const burst = await getTrailingUserMessageBurst(conversationId);
    if (burst.length === 0) {
      console.log('[ANA_PIPELINE] flush_skip', {
        reason: 'empty_trailing_user_burst',
        conversationId,
        pipelineToken,
        toPhoneTail: phoneTail(toPhoneNumber, 6),
        inboundMetaMessageId,
      });
      return;
    }
    const merged = burst
      .map((m) => (m.content || '').trim())
      .filter(Boolean)
      .join('\n');
    if (!merged) {
      console.log('[ANA_PIPELINE] flush_skip', {
        reason: 'empty_merged_burst_text',
        conversationId,
        pipelineToken,
        toPhoneTail: phoneTail(toPhoneNumber, 6),
        inboundMetaMessageId,
        burstDbIds: burst.map((m) => m.id),
      });
      return;
    }
    if (getConversationPipelineToken(conversationId) !== pipelineToken) {
      console.log('[ANA_PIPELINE] flush_skip', {
        reason: 'pipeline_token_mismatch_before_engine',
        conversationId,
        pipelineToken,
        currentToken: getConversationPipelineToken(conversationId),
        toPhoneTail: phoneTail(toPhoneNumber, 6),
        inboundMetaMessageId,
      });
      return;
    }
    const lastBurstMeta = [...burst].reverse().find((m) => m.meta_message_id)?.meta_message_id ?? null;
    const effectiveMetaMessageId = inboundMetaMessageId ?? lastBurstMeta;
    console.log('[ANA_PIPELINE] flush_dispatch', {
      conversationId,
      pipelineToken,
      toPhoneTail: phoneTail(toPhoneNumber, 6),
      inboundMetaMessageId: effectiveMetaMessageId,
      mergedLen: merged.length,
      trailingUserBubbles: burst.length,
    });

    // Rollout controlado do grafo novo (fase 11): quando o enterpriseId da
    // conversa está na allowlist de produção, o grafo responde de verdade no
    // lugar do motor legado — nunca os dois, pra não duplicar resposta.
    // Fora da allowlist, comportamento inalterado (motor legado, como sempre).
    //
    // Se o grafo falhar (result.handled === false — ex.: erro de infra do
    // checkpointer, exceção não prevista), cai pro motor legado em vez de
    // devolver silêncio total ao cliente. Um subsistema novo/não totalmente
    // validado nunca deve poder causar ausência completa de resposta —
    // mesma lição da rede de segurança já existente em conversationEngine.ts
    // (ANA_BLOCKED_TURN_FALLBACK_ENABLED) para o motor legado.
    const conversation = await getConversationById(conversationId);
    if (isAnaGraphProductionEnabledForEnterprise(conversation?.enterprise_id ?? null)) {
      console.log('[ANA_PIPELINE] routed_to_graph_production', {
        conversationId,
        pipelineToken,
        enterpriseId: conversation?.enterprise_id ?? null,
      });
      const graphResult = await runAnaGraphProduction({
        conversationId,
        contactId: conversation?.contact_id ?? null,
        enterpriseId: conversation?.enterprise_id ?? null,
        userMessage: merged,
        metaMessageId: effectiveMetaMessageId,
        phoneNumberId: null,
      });
      if (graphResult.handled) {
        return;
      }
      console.error('[ANA_PIPELINE] graph_production_failed_fallback_to_legacy', {
        conversationId,
        pipelineToken,
        enterpriseId: conversation?.enterprise_id ?? null,
        graphError: graphResult.error,
      });
    }

    await handleIncomingMessage({
      conversationId,
      userMessage: merged,
      toPhoneNumber,
      trailingUserBubbles: burst.length,
      replyPipelineToken: pipelineToken,
      inboundMetaMessageId: effectiveMetaMessageId,
    });
  } catch (e) {
    console.error('[ANA_PIPELINE] flush_error', e instanceof Error ? e.message : String(e));
  }
}
