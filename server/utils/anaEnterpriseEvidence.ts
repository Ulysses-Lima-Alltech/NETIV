import type { EnterpriseRow } from '../repositories/enterpriseRepository.js';
import type { CommercialAxis } from './anaCommercialAxisGuard.js';

type EnterpriseFileLite = {
  category: string;
  is_active: boolean;
  can_be_sent_by_ana: boolean;
  can_be_used_as_knowledge: boolean;
  original_name: string;
};

export interface AnaEnterpriseEvidence {
  hasSendableBook: boolean;
  hasSendableFloorplan: boolean;
  hasAnySendableMaterial: boolean;
  hasExactLocation: boolean;
  hasPricingInfo: boolean;
  hasFinancingInfo: boolean;
  hasUsableKnowledgeChunks: boolean;
}

export type AnaEvidenceNeed = CommercialAxis | 'material' | 'localizacao_exata' | 'geral';

export function hasAnaEvidenceForNeed(
  evidence: AnaEnterpriseEvidence,
  need: AnaEvidenceNeed
): boolean {
  switch (need) {
    case 'material':
      return evidence.hasAnySendableMaterial;
    case 'localizacao_exata':
      return evidence.hasExactLocation;
    case 'preco':
      return evidence.hasPricingInfo;
    case 'financiamento':
      return evidence.hasFinancingInfo;
    case 'localizacao':
      return evidence.hasUsableKnowledgeChunks || evidence.hasExactLocation;
    case 'metragem_tipologia':
    case 'lazer':
    case 'disponibilidade':
    case 'visita_agendamento':
    case 'intencao_compra':
    case 'geral':
      return evidence.hasUsableKnowledgeChunks;
    default:
      return evidence.hasUsableKnowledgeChunks;
  }
}

function norm(s: string): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasAddressLikeSignal(text: string): boolean {
  const n = norm(text);
  if (!n) return false;
  return (
    /\b(rua|avenida|av|alameda|rodovia|estrada|travessa|praca)\b/.test(n) ||
    /\b(numero|n)\s*\d+/.test(n) ||
    /\b(cep|mapa|google maps)\b/.test(n)
  );
}

function hasStrongFinancialSignal(text: string): boolean {
  const n = norm(text);
  if (!n) return false;
  return /\br\$\s*\d|a partir de|preco|valor(es)?\b/.test(n);
}

function hasFinancingSignal(text: string): boolean {
  const n = norm(text);
  if (!n) return false;
  return /\b(financiamento|formas?\s+de\s+pagamento|condic(?:ao|oes)\s+de\s+pagamento|pagamento|parcelamento|parcela|entrada|fgts|mcmv|minha casa minha vida|subsidi)\b/.test(n);
}

export function buildAnaEnterpriseEvidence(params: {
  enterprise: EnterpriseRow | null;
  files: EnterpriseFileLite[];
  variablesMap: Record<string, string>;
  knowledgeText: string;
}): AnaEnterpriseEvidence {
  const { enterprise, files, variablesMap, knowledgeText } = params;
  const sendable = files.filter((f) => f.is_active && f.can_be_sent_by_ana);
  const usableKnowledgeFiles = files.filter((f) => f.is_active && f.can_be_used_as_knowledge);
  const joinedVars = Object.values(variablesMap || {}).filter(Boolean).join('\n');
  const city = (enterprise?.city || '').trim();

  const hasSendableBook = sendable.some((f) => norm(f.category) === 'book');
  const hasSendableFloorplan = sendable.some((f) => norm(f.category) === 'unidades');
  const hasAnySendableMaterial = sendable.length > 0;
  const hasExactLocation = Boolean(city) && (hasAddressLikeSignal(joinedVars) || hasAddressLikeSignal(knowledgeText));
  const hasPricingInfo =
    hasStrongFinancialSignal(variablesMap.preco || '') ||
    hasStrongFinancialSignal(joinedVars) ||
    hasStrongFinancialSignal(knowledgeText);
  const hasFinancingInfo =
    hasFinancingSignal(variablesMap.condicoes || '') ||
    hasFinancingSignal(joinedVars) ||
    hasFinancingSignal(knowledgeText);
  const hasUsableKnowledgeChunks = usableKnowledgeFiles.length > 0 || norm(knowledgeText).length > 80;

  return {
    hasSendableBook,
    hasSendableFloorplan,
    hasAnySendableMaterial,
    hasExactLocation,
    hasPricingInfo,
    hasFinancingInfo,
    hasUsableKnowledgeChunks,
  };
}

function blockReasonForReply(
  reply: string,
  ev: AnaEnterpriseEvidence,
  opts?: { allowMaterialOffer?: boolean }
): string | null {
  const n = norm(reply);
  if (!n) return null;
  const promisedBook = /\b(tenho (o )?(book|catalogo|material|pdf)|posso te enviar (o )?(book|catalogo|material|pdf)|vou te (enviar|mandar) (o )?(book|catalogo|material|pdf))\b/.test(
    n
  );
  if (promisedBook && !ev.hasSendableBook) return 'book_not_sendable';

  const promisedFloorplan = /\b(tenho (a )?planta|posso te enviar (a )?planta|vou te (enviar|mandar) (a )?planta)\b/.test(
    n
  );
  if (promisedFloorplan && !ev.hasSendableFloorplan) return 'floorplan_not_sendable';

  const genericMaterialOffer =
    /\b(posso te enviar|vou te enviar|vou te mandar|te envio|te mando|material|book|catalogo|planta|pdf)\b/.test(n);
  if (opts?.allowMaterialOffer !== true && (promisedBook || promisedFloorplan || genericMaterialOffer)) {
    return 'unsolicited_material_offer';
  }

  const promisedExactLocation =
    /\b(tenho (o )?(endereco|localizacao exata)|posso te passar (o )?endereco|te passo o endereco exato)\b/.test(
      n
    );
  if (promisedExactLocation && !ev.hasExactLocation) return 'exact_location_not_available';

  const indirectPromise =
    /\b(posso pedir para te enviarem|posso solicitar ao corretor|posso te passar depois|consigo levantar isso)\b/.test(
      n
    );
  if (indirectPromise) return 'unsupported_indirect_promise';

  return null;
}

export function applyAnaEvidenceGuardToReply(
  reply: string,
  evidence: AnaEnterpriseEvidence,
  opts?: { allowMaterialOffer?: boolean }
): { text: string; changed: boolean; blockedOfferReason: string | null } {
  const reason = blockReasonForReply(reply, evidence, opts);
  if (!reason) return { text: reply, changed: false, blockedOfferReason: null };

  const pieces = (reply || '')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const filtered = pieces.filter((sentence) => !blockReasonForReply(sentence, evidence, opts));
  const stripped = filtered.join(' ').replace(/\s+/g, ' ').trim();

  return { text: stripped, changed: true, blockedOfferReason: reason };
}
