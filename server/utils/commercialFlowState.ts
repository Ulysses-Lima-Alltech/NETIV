import type { EnterpriseRow } from '../repositories/enterpriseRepository.js';
import type { RequestedProductType } from './anaRequestedProductType.js';
import {
  extractCatalogEnterpriseNamesFromAssistantReply,
  tryMatchEnterpriseFromUserCorpus,
} from '../repositories/enterpriseMatch.js';

/** Estado persistido em `conversations.commercial_flow_state` (JSON). */
export interface CommercialFlowState {
  stage?: string;
  productTypeHint?: RequestedProductType | string;
  lastCatalogOfferedNames?: string[];
  /** Quando a última resposta da Ana listou exatamente um 📍 — ID resolvido no backend. */
  lastSingleCatalogEnterpriseId?: number | null;
  /** Último empreendimento inferido do texto da assistente ou já focado na conversa. */
  lastInferredEnterpriseId?: number | null;
  lastAssistantSnippet?: string;
  updatedAt?: string;
}

export function parseCommercialFlowState(raw: unknown): CommercialFlowState | null {
  if (raw == null) return null;
  if (typeof raw === 'string') {
    try {
      const o = JSON.parse(raw) as unknown;
      return typeof o === 'object' && o !== null && !Array.isArray(o) ? (o as CommercialFlowState) : null;
    } catch {
      return null;
    }
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw as CommercialFlowState;
  return null;
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Mensagens curtas típicas de continuação (atributo, confirmação) — não devem reabrir triagem.
 * `explicitSwitch` = frases tipo "me fale sobre o X" (outro handler já trata).
 */
export function isShortCommercialContinuation(trimmed: string, explicitSwitch: boolean): boolean {
  if (explicitSwitch) return false;
  const t = trimmed.trim();
  if (!t || t.length > 96) return false;
  const words = t.split(/\s+/).length;
  if (words > 6) return false;
  const n = norm(t);

  if (
    /\b(quero\s+um\s+loteamento|quero\s+apartamento|quais\s+opcoes|quais\s+empreendimentos|me\s+fale\s+do|me\s+fale\s+sobre|me\s+fala\s+do|me\s+fala\s+sobre|gostaria\s+de\s+saber|tenho\s+interesse)\b/.test(
      n
    )
  ) {
    return false;
  }

  if (
    /\b(lazer|localizacao|localização|seguranca|segurança|metragem|valor|valores|condicoes|condições|condicao|condição|financiamento|parcelamento|infraestrutura|area\s+verde|vagas|quero\s+saber\s+mais|tabela|plantas?)\b/.test(
      n
    )
  ) {
    return true;
  }

  if (words <= 2 && t.length <= 32) {
    if (/^(sim|nao|não|ok|isso|beleza|perfeito|legal|aham|uhum)$/i.test(t.trim())) return true;
  }

  return false;
}

export interface RecoverEnterpriseResult {
  enterpriseId: number;
  source: string;
}

/**
 * Recupera foco de empreendimento antes do match por mensagem atual quando:
 * - ainda não há `enterprise_id` na conversa, mas
 * - o cliente respondeu algo curto (ex.: "lazer") e
 * - há contexto forte na última assistente ou estado persistido.
 */
export function tryRecoverEnterpriseIdFromFlowState(args: {
  trimmedUser: string;
  enterpriseIdInDb: number | null;
  lastAssistantText: string;
  flowState: CommercialFlowState | null;
  explicitSwitch: boolean;
  matchPool: EnterpriseRow[];
  allEnterprises: EnterpriseRow[];
}): RecoverEnterpriseResult | null {
  if (args.enterpriseIdInDb != null) return null;
  if (!isShortCommercialContinuation(args.trimmedUser, args.explicitSwitch)) return null;

  const st = args.flowState;
  if (st?.lastSingleCatalogEnterpriseId != null && Number.isFinite(st.lastSingleCatalogEnterpriseId)) {
    return { enterpriseId: st.lastSingleCatalogEnterpriseId, source: 'persisted_last_single_catalog' };
  }
  if (st?.lastInferredEnterpriseId != null && Number.isFinite(st.lastInferredEnterpriseId)) {
    return { enterpriseId: st.lastInferredEnterpriseId, source: 'persisted_last_inferred' };
  }

  const listed = extractCatalogEnterpriseNamesFromAssistantReply(args.lastAssistantText);
  if (listed.length === 1) {
    const id = tryMatchEnterpriseFromUserCorpus(listed[0]!, args.matchPool);
    if (id != null) return { enterpriseId: id, source: 'assistant_single_catalog_emoji' };
  }

  const fromBody = tryMatchEnterpriseFromUserCorpus(args.lastAssistantText, args.allEnterprises);
  if (fromBody != null) return { enterpriseId: fromBody, source: 'assistant_text_unique_mention' };

  return null;
}

export function computeNextCommercialFlowState(
  prev: CommercialFlowState | null,
  assistantReply: string,
  opts: {
    conversationPhase: string;
    enterpriseIdResolved: number | null;
    enterprises: EnterpriseRow[];
    productTypeHint: RequestedProductType | undefined;
  }
): CommercialFlowState {
  const catalogNames = extractCatalogEnterpriseNamesFromAssistantReply(assistantReply);
  let lastSingleCatalogEnterpriseId: number | null = null;
  if (catalogNames.length === 1) {
    const id = tryMatchEnterpriseFromUserCorpus(catalogNames[0]!, opts.enterprises);
    if (id != null) lastSingleCatalogEnterpriseId = id;
  }

  let lastInferred: number | null = opts.enterpriseIdResolved;
  if (lastInferred == null) {
    const inf = tryMatchEnterpriseFromUserCorpus(assistantReply, opts.enterprises);
    if (inf != null) lastInferred = inf;
  }
  if (lastInferred == null) {
    lastInferred = prev?.lastInferredEnterpriseId ?? null;
  }

  return {
    ...prev,
    stage: opts.conversationPhase,
    productTypeHint: opts.productTypeHint ?? prev?.productTypeHint,
    lastCatalogOfferedNames: catalogNames.length > 0 ? catalogNames : prev?.lastCatalogOfferedNames,
    lastSingleCatalogEnterpriseId,
    lastInferredEnterpriseId: lastInferred,
    lastAssistantSnippet: assistantReply.slice(0, 480),
    updatedAt: new Date().toISOString(),
  };
}
