import { getMessagesByConversationId } from '../repositories/messageRepository.js';
import { getOpenAIConfig } from '../repositories/openaiConfigRepository.js';
import { generateChatCompletion, type ChatMessage } from './openaiService.js';
import { query } from '../db/pg.js';
import type { ReserveSegmentationPatch } from '../repositories/conversationRepository.js';
import { RESERVE_INTEREST_TYPES, RESERVE_REASONS } from '../constants/reserveSegmentation.js';

const EXTRACT_JSON = `Retorne APENAS JSON válido (sem markdown), chaves em inglês:
{
  "reason": string | null,
  "desiredCity": string | null,
  "desiredPriceMin": number | null,
  "desiredPriceMax": number | null,
  "propertyType": string | null,
  "bedrooms": number | null,
  "interestType": string | null,
  "followUpMoment": string | null,
  "commercialNotes": string | null
}
Use null quando não houver informação clara. reason deve ser um destes ou null: ${RESERVE_REASONS.join(', ')}.
interestType deve ser um destes ou null: ${RESERVE_INTEREST_TYPES.join(', ')}.`;

function parseExtractJson(raw: string): ReserveSegmentationPatch | null {
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  try {
    const o = JSON.parse(s) as Record<string, unknown>;
    const patch: ReserveSegmentationPatch = {};
    if (typeof o.reason === 'string' && RESERVE_REASONS.includes(o.reason as (typeof RESERVE_REASONS)[number]))
      patch.reason = o.reason;
    if (typeof o.desiredCity === 'string') patch.desiredCity = o.desiredCity.trim() || null;
    if (typeof o.desiredPriceMin === 'number' && Number.isFinite(o.desiredPriceMin)) patch.desiredPriceMin = o.desiredPriceMin;
    if (typeof o.desiredPriceMax === 'number' && Number.isFinite(o.desiredPriceMax)) patch.desiredPriceMax = o.desiredPriceMax;
    if (typeof o.propertyType === 'string') patch.propertyType = o.propertyType.trim() || null;
    if (typeof o.bedrooms === 'number' && Number.isFinite(o.bedrooms)) patch.bedrooms = Math.round(o.bedrooms);
    if (typeof o.interestType === 'string' && RESERVE_INTEREST_TYPES.includes(o.interestType as (typeof RESERVE_INTEREST_TYPES)[number]))
      patch.interestType = o.interestType;
    if (typeof o.followUpMoment === 'string') patch.followUpMoment = o.followUpMoment.trim() || null;
    if (typeof o.commercialNotes === 'string') patch.commercialNotes = o.commercialNotes.trim() || null;
    return patch;
  } catch {
    return null;
  }
}

/**
 * Preenche segmentação da Carteira a partir do histórico de mensagens (LLM).
 * Não sobrescreve campos já preenchidos no banco (merge conservador).
 */
export async function extractLeadDataFromConversation(
  conversationId: number,
  customerName: string | null,
  enterpriseName: string | null
): Promise<void> {
  const aiConfig = await getOpenAIConfig();
  if (!aiConfig?.openaiApiKey?.trim() || !aiConfig.aiEnabled) return;

  const rows = await getMessagesByConversationId(conversationId);
  const transcript = rows
    .map((m) => `${m.role === 'user' ? 'Cliente' : 'Ana'}: ${(m.content || '').trim()}`)
    .filter((l) => l.length > 12)
    .slice(-40)
    .join('\n');
  if (transcript.length < 20) return;

  const model = aiConfig.modelColdLead || 'gpt-4o-mini';
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `Você extrai dados comerciais de conversas de WhatsApp imobiliário. ${EXTRACT_JSON}`,
    },
    {
      role: 'user',
      content: `Nome do cliente (se conhecido): ${customerName || 'desconhecido'}\nEmpreendimento em foco: ${enterpriseName || 'não informado'}\n\nTranscrição:\n${transcript}`,
    },
  ];

  const result = await generateChatCompletion({
    apiKey: aiConfig.openaiApiKey,
    baseUrl: aiConfig.openaiBaseUrl,
    model,
    messages,
    temperature: 0.2,
    maxTokens: 600,
    responseFormatJson: true,
  });
  if (!result.success || !result.content) return;
  const patch = parseExtractJson(result.content);
  if (!patch || Object.keys(patch).length === 0) return;

  const { rows: curRows } = await query<{
    reserve_reason: string | null;
    reserve_desired_city: string | null;
    reserve_price_min: string | number | null;
    reserve_price_max: string | number | null;
    reserve_property_type: string | null;
    reserve_bedrooms: number | null;
    reserve_interest_type: string | null;
    reserve_follow_up_moment: string | null;
    reserve_commercial_notes: string | null;
  }>(
    `SELECT reserve_reason, reserve_desired_city, reserve_price_min, reserve_price_max,
            reserve_property_type, reserve_bedrooms, reserve_interest_type,
            reserve_follow_up_moment, reserve_commercial_notes
     FROM conversations WHERE id = $1`,
    [conversationId]
  );
  const cur = curRows[0];
  if (!cur) return;

  const merged: ReserveSegmentationPatch = {};
  if (patch.reason != null && !cur.reserve_reason) merged.reason = patch.reason;
  if (patch.desiredCity != null && !cur.reserve_desired_city?.trim()) merged.desiredCity = patch.desiredCity;
  if (patch.desiredPriceMin != null && cur.reserve_price_min == null) merged.desiredPriceMin = patch.desiredPriceMin;
  if (patch.desiredPriceMax != null && cur.reserve_price_max == null) merged.desiredPriceMax = patch.desiredPriceMax;
  if (patch.propertyType != null && !cur.reserve_property_type?.trim()) merged.propertyType = patch.propertyType;
  if (patch.bedrooms != null && cur.reserve_bedrooms == null) merged.bedrooms = patch.bedrooms;
  if (patch.interestType != null && !cur.reserve_interest_type?.trim()) merged.interestType = patch.interestType;
  if (patch.followUpMoment != null && !cur.reserve_follow_up_moment?.trim()) merged.followUpMoment = patch.followUpMoment;
  if (patch.commercialNotes != null && !cur.reserve_commercial_notes?.trim()) merged.commercialNotes = patch.commercialNotes;

  if (Object.keys(merged).length === 0) return;

  await query(
    `UPDATE conversations SET
       reserve_reason = COALESCE(reserve_reason, $2),
       reserve_desired_city = COALESCE(reserve_desired_city, $3),
       reserve_price_min = COALESCE(reserve_price_min, $4),
       reserve_price_max = COALESCE(reserve_price_max, $5),
       reserve_property_type = COALESCE(reserve_property_type, $6),
       reserve_bedrooms = COALESCE(reserve_bedrooms, $7),
       reserve_interest_type = COALESCE(reserve_interest_type, $8),
       reserve_follow_up_moment = COALESCE(reserve_follow_up_moment, $9),
       reserve_commercial_notes = COALESCE(reserve_commercial_notes, $10),
       updated_at = NOW()
     WHERE id = $1`,
    [
      conversationId,
      merged.reason ?? null,
      merged.desiredCity ?? null,
      merged.desiredPriceMin ?? null,
      merged.desiredPriceMax ?? null,
      merged.propertyType ?? null,
      merged.bedrooms ?? null,
      merged.interestType ?? null,
      merged.followUpMoment ?? null,
      merged.commercialNotes ?? null,
    ]
  );
}
