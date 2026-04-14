import type { EnterpriseRow } from '../repositories/enterpriseRepository.js';

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
    /\b(rua|avenida|av|alameda|rodovia|estrada|travessa|praca|praça)\b/.test(n) ||
    /\b(n[ºo°]|numero|número)\s*\d+/.test(n) ||
    /\b(cep|mapa|google maps)\b/.test(n)
  );
}

function hasStrongFinancialSignal(text: string): boolean {
  const n = norm(text);
  if (!n) return false;
  return /\br\$\s*\d|a partir de|preco|preço|valor(es)?\b/.test(n);
}

function hasFinancingSignal(text: string): boolean {
  const n = norm(text);
  if (!n) return false;
  return /\b(financiamento|parcelamento|parcela|entrada|fgts|mcmv|minha casa minha vida|subsidi)\b/.test(n);
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
  const hasPricingInfo = hasStrongFinancialSignal(variablesMap.preco || '') || hasStrongFinancialSignal(joinedVars);
  const hasFinancingInfo = hasFinancingSignal(variablesMap.condicoes || '') || hasFinancingSignal(joinedVars);
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

function blockReasonForReply(reply: string, ev: AnaEnterpriseEvidence): string | null {
  const n = norm(reply);
  if (!n) return null;
  const promisedBook = /\b(tenho (o )?(book|catalogo|catálogo|material|pdf)|posso te enviar (o )?(book|catalogo|catálogo|material|pdf)|vou te (enviar|mandar) (o )?(book|catalogo|catálogo|material|pdf))\b/.test(
    n
  );
  if (promisedBook && !ev.hasSendableBook) return 'book_not_sendable';

  const promisedFloorplan = /\b(tenho (a )?planta|posso te enviar (a )?planta|vou te (enviar|mandar) (a )?planta)\b/.test(
    n
  );
  if (promisedFloorplan && !ev.hasSendableFloorplan) return 'floorplan_not_sendable';

  const promisedExactLocation =
    /\b(tenho (o )?(endereco|endereço|localizacao exata|localização exata)|posso te passar (o )?(endereco|endereço)|te passo o endereco exato|te passo o endereço exato)\b/.test(
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
  evidence: AnaEnterpriseEvidence
): { text: string; changed: boolean; blockedOfferReason: string | null } {
  const reason = blockReasonForReply(reply, evidence);
  if (!reason) return { text: reply, changed: false, blockedOfferReason: null };

  let safe = 'No material que tenho aqui agora, essa informação específica não está disponível.';
  if (reason === 'book_not_sendable') {
    safe = 'No momento, eu não tenho um book disponível aqui para te enviar.';
  } else if (reason === 'floorplan_not_sendable') {
    safe = 'No material que tenho aqui, a planta detalhada não está disponível para envio.';
  } else if (reason === 'exact_location_not_available') {
    safe = 'No material que tenho aqui agora, não encontrei o endereço exato para te passar.';
  } else if (reason === 'unsupported_indirect_promise') {
    safe = 'No momento, só consigo te passar o que já está disponível no sistema.';
  }

  return { text: safe, changed: true, blockedOfferReason: reason };
}
