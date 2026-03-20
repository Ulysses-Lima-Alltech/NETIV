import { getActiveEnterpriseById } from '../repositories/enterpriseRepository.js';
import {
  lookupLeadSourceEnterpriseMapping,
  normalizeLeadSourceKey,
} from '../repositories/leadSourceMappingRepository.js';

/** Monta origem a partir do payload de mensagem WhatsApp Cloud API (referral de anúncio, etc.). */
export function leadOriginFromMetaWhatsAppMessage(
  msg: Record<string, unknown> | null | undefined,
  phoneNumberId: string | null
): LeadOriginInput | null {
  if (!msg) return null;
  const raw: Record<string, unknown> = {};
  const ref = msg.referral;
  if (ref && typeof ref === 'object' && !Array.isArray(ref)) {
    raw.referral = ref;
  }
  if (phoneNumberId?.trim()) {
    raw.meta_phone_number_id = phoneNumberId.trim();
  }
  if (Object.keys(raw).length === 0) return null;
  return { rawSnapshot: raw };
}

export interface LeadOriginInput {
  /** ID explícito quando o integrador envia empreendimento confiável. */
  explicitEnterpriseId?: number | null;
  /** Chave cadastrada em `lead_source_enterprise_map`. */
  sourceKey?: string | null;
  /** Snapshot (ex.: referral Meta) — armazenado em `lead_source_raw`; usado para chaves meta:* */
  rawSnapshot?: Record<string, unknown> | null;
}

function referralObject(raw: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  const r = raw?.referral;
  if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
  return r as Record<string, unknown>;
}

/** Monta lista ordenada de chaves candidatas para lookup na tabela de mapeamento (sem heurística frágil em texto livre). */
export function buildCandidateSourceKeys(input: LeadOriginInput): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  const push = (k: string) => {
    const n = normalizeLeadSourceKey(k);
    if (!n || seen.has(n)) return;
    seen.add(n);
    out.push(n);
  };

  if (input.sourceKey) push(input.sourceKey);

  const ref = referralObject(input.rawSnapshot ?? undefined);
  if (ref) {
    const sid = ref.source_id;
    if (typeof sid === 'string' && sid.trim()) {
      push(`meta:referral:source_id:${normalizeLeadSourceKey(sid)}`);
    }
    const ctwa = ref.ctwa_clid;
    if (typeof ctwa === 'string' && ctwa.trim()) {
      push(`meta:referral:ctwa_clid:${normalizeLeadSourceKey(ctwa)}`);
    }
  }

  return out;
}

/**
 * Resolve empreendimento de origem com segurança:
 * 1) explicitEnterpriseId se ativo
 * 2) primeiras chaves com match em lead_source_enterprise_map
 */
export async function resolveEnterpriseFromLeadSource(
  input: LeadOriginInput | null | undefined
): Promise<{ enterpriseId: number | null; matchedVia: 'explicit' | 'source_map' | null; matchedKey: string | null }> {
  if (!input) return { enterpriseId: null, matchedVia: null, matchedKey: null };

  if (input.explicitEnterpriseId != null && !Number.isNaN(input.explicitEnterpriseId)) {
    const ok = await getActiveEnterpriseById(input.explicitEnterpriseId);
    if (ok) {
      return {
        enterpriseId: input.explicitEnterpriseId,
        matchedVia: 'explicit',
        matchedKey: null,
      };
    }
  }

  for (const key of buildCandidateSourceKeys(input)) {
    const id = await lookupLeadSourceEnterpriseMapping(key);
    if (id != null) {
      return { enterpriseId: id, matchedVia: 'source_map', matchedKey: key };
    }
  }

  return { enterpriseId: null, matchedVia: null, matchedKey: null };
}
