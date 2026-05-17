import { normalizeEnterpriseAliasText } from '../repositories/enterpriseMatch.js';
import type { EnterpriseRow } from '../repositories/enterpriseRepository.js';
import type { ConversationMessageSnippet } from '../repositories/messageRepository.js';
import {
  generateChatCompletion,
  type GenerateCompletionResult,
} from './openaiService.js';
import { resolveAiSettingsForEnterprise } from './enterpriseAiSettingsService.js';

export type LeadTemperatureLabel = 'Frio' | 'Morno' | 'Quente';
export type LeadMainIntent =
  | 'saudacao'
  | 'informacoes_gerais'
  | 'preco'
  | 'disponibilidade'
  | 'localizacao'
  | 'metragem'
  | 'visita'
  | 'simulacao'
  | 'corretor'
  | 'material'
  | 'outro';

export type LeadFunnelStatus = 'Novo' | 'Qualificado' | 'Em atendimento' | 'Agendado' | null;

export interface EnterpriseAliasRowInput {
  enterprise_id: number;
  alias: string;
  normalized_alias: string | null;
}

export interface ClassifyLeadConversationInput {
  conversationId: number;
  contactId: number | null;
  latestCustomerMessage: string;
  recentMessages: ConversationMessageSnippet[];
  currentTemperature: string | null;
  currentEnterpriseId: number | null;
  currentFunnelStatus: string | null;
  availableEnterprises: EnterpriseRow[];
  enterpriseAliasRows: EnterpriseAliasRowInput[];
  manualOverrideFlags: {
    temperature: boolean;
    enterprise: boolean;
  };
}

export interface LeadClassifierOutputSchema {
  temperature: LeadTemperatureLabel;
  temperatureConfidence: number;
  temperatureReason: string;
  enterpriseId: number | null;
  enterpriseName: string | null;
  enterpriseConfidence: number;
  enterpriseReason: string;
  funnelStatus: LeadFunnelStatus;
  funnelConfidence: number;
  mainIntent: LeadMainIntent;
  shouldUpdateTemperature: boolean;
  shouldUpdateEnterprise: boolean;
  shouldUpdateFunnel: boolean;
}

export interface LeadClassifierDecision extends LeadClassifierOutputSchema {
  source: 'ai' | 'fallback';
  ignoredReasons: string[];
  classifierError: string | null;
  rawClassifierJson: string | null;
}

interface LeadClassifierDependencies {
  loadOpenAIConfig: (enterpriseId?: number | null) => Promise<{
    openaiApiKey: string;
    openaiBaseUrl: string | null;
    modelColdLead: string;
    modelHotLead: string;
    maxTokens: number;
    blockedReason?: string | null;
    apiKeySource?: 'enterprise' | 'global_fallback';
    openaiApiKeyId?: string | null;
    openaiProjectId?: string | null;
    costTrackingEnabled?: boolean;
  } | null>;
  generateCompletion: (params: {
    apiKey: string;
    baseUrl: string | null;
    model: string;
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
    temperature: number;
    maxTokens: number;
    responseFormatJson?: boolean;
    costTracking?: {
      purpose: string;
      conversationId?: number | null;
      contactId?: number | null;
      enterpriseId?: number | null;
      modelReason?: string | null;
      apiKeySource?: 'enterprise' | 'global_fallback';
      openaiApiKeyId?: string | null;
      openaiProjectId?: string | null;
      requestType?: string | null;
      metadata?: Record<string, unknown>;
    };
  }) => Promise<GenerateCompletionResult>;
}

const DEFAULT_DEPS: LeadClassifierDependencies = {
  loadOpenAIConfig: async (enterpriseId?: number | null) => {
    const resolved = await resolveAiSettingsForEnterprise(enterpriseId ?? null);
    if (resolved.blocked || !resolved.openaiApiKey) {
      return {
        openaiApiKey: '',
        openaiBaseUrl: resolved.openaiBaseUrl,
        modelColdLead: resolved.modelColdLead,
        modelHotLead: resolved.modelHotLead,
        maxTokens: resolved.maxTokens,
        blockedReason: resolved.reason,
        apiKeySource: resolved.apiKeySource ?? undefined,
        openaiApiKeyId: resolved.openaiApiKeyId ?? null,
        openaiProjectId: resolved.openaiProjectId ?? null,
        costTrackingEnabled: resolved.costTrackingEnabled,
      };
    }
    return {
      openaiApiKey: resolved.openaiApiKey,
      openaiBaseUrl: resolved.openaiBaseUrl,
      modelColdLead: resolved.modelColdLead,
      modelHotLead: resolved.modelHotLead,
      maxTokens: resolved.maxTokens,
      blockedReason: null,
      apiKeySource: resolved.apiKeySource ?? undefined,
      openaiApiKeyId: resolved.openaiApiKeyId,
      openaiProjectId: resolved.openaiProjectId,
      costTrackingEnabled: resolved.costTrackingEnabled,
    };
  },
  generateCompletion: generateChatCompletion,
};

const TEMP_RANK: Record<LeadTemperatureLabel, number> = {
  Frio: 0,
  Morno: 1,
  Quente: 2,
};

const MAIN_INTENTS: LeadMainIntent[] = [
  'saudacao',
  'informacoes_gerais',
  'preco',
  'disponibilidade',
  'localizacao',
  'metragem',
  'visita',
  'simulacao',
  'corretor',
  'material',
  'outro',
];

const SUPPORTED_FUNNEL: Array<Exclude<LeadFunnelStatus, null>> = [
  'Novo',
  'Qualificado',
  'Em atendimento',
  'Agendado',
];

const CLEAR_COOLING_PATTERNS: RegExp[] = [
  /\b(nao tenho interesse|sem interesse)\b/,
  /\b(nao quero seguir|nao vou seguir|nao vou continuar)\b/,
  /\b(deixa pra la|deixa para la)\b/,
  /\b(nao agora|talvez depois)\b/,
  /\b(pode encerrar|pode cancelar)\b/,
  /\b(era so curiosidade|so estava pesquisando)\b/,
];

const NEUTRAL_SHORT_PATTERNS: RegExp[] = [
  /^(oi|ola|olá|bom dia|boa tarde|boa noite)$/i,
  /^(ok|blz|beleza|certo|perfeito|show|valeu|obrigado|obg)$/i,
  /^(sim|nao|não|isso|entendi)$/i,
];

function normalizeText(input: string): string {
  return (input || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactText(input: string): string {
  return normalizeText(input).replace(/\s+/g, '');
}

function clamp01(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return Math.round(n * 1000) / 1000;
}

function titleCaseTemperature(input: string | null | undefined): LeadTemperatureLabel | null {
  const n = normalizeText(String(input ?? ''));
  if (n === 'frio' || n === 'cold') return 'Frio';
  if (n === 'morno' || n === 'warm') return 'Morno';
  if (n === 'quente' || n === 'hot') return 'Quente';
  return null;
}

function normalizeFunnelStatus(raw: unknown): LeadFunnelStatus {
  if (raw == null) return null;
  const s = normalizeText(String(raw));
  if (s === 'novo') return 'Novo';
  if (s === 'qualificado') return 'Qualificado';
  if (s === 'em atendimento' || s === 'ematendimento') return 'Em atendimento';
  if (s === 'agendado') return 'Agendado';
  return null;
}

function normalizeMainIntent(raw: unknown): LeadMainIntent {
  const s = normalizeText(String(raw ?? ''));
  const found = MAIN_INTENTS.find((intent) => intent === s);
  return found ?? 'outro';
}

function normalizeCurrentTemperature(raw: string | null | undefined): LeadTemperatureLabel | null {
  return titleCaseTemperature(raw);
}

function isNeutralShortMessage(raw: string): boolean {
  const trimmed = (raw || '').trim();
  if (!trimmed) return true;
  if (trimmed.length <= 3) return true;
  if (NEUTRAL_SHORT_PATTERNS.some((pattern) => pattern.test(trimmed))) return true;
  const norm = normalizeText(trimmed);
  const words = norm.split(' ').filter(Boolean);
  if (words.length <= 2) {
    if (['sim', 'nao', 'nao sei', 'ok', 'beleza', 'entendi', 'obrigado', 'valeu'].includes(norm)) return true;
  }
  return false;
}

function hasClearCoolingEvidence(messages: string[]): boolean {
  const normMessages = messages.map((msg) => normalizeText(msg)).filter(Boolean);
  return normMessages.some((msg) => CLEAR_COOLING_PATTERNS.some((pattern) => pattern.test(msg)));
}

function toShortReason(value: unknown, fallback: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return fallback;
  return text.slice(0, 240);
}

function parseBoolean(value: unknown): boolean {
  return value === true;
}

function parseEnterpriseId(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  const int = Math.floor(n);
  if (int <= 0) return null;
  return int;
}

function buildPromptInputPayload(input: ClassifyLeadConversationInput): string {
  const enterprises = input.availableEnterprises.map((enterprise) => ({
    id: enterprise.id,
    name: enterprise.name,
    slug: enterprise.slug,
  }));
  const aliases = input.enterpriseAliasRows.map((row) => ({
    enterpriseId: row.enterprise_id,
    alias: row.alias,
    normalizedAlias: row.normalized_alias,
  }));
  const recentMessages = input.recentMessages.slice(-12).map((message) => ({
    role: message.role,
    content: message.content.slice(0, 500),
  }));
  const payload = {
    conversationId: input.conversationId,
    latestCustomerMessage: input.latestCustomerMessage.slice(0, 1200),
    recentMessages,
    currentTemperature: input.currentTemperature ?? null,
    currentEnterpriseId: input.currentEnterpriseId ?? null,
    currentFunnelStatus: input.currentFunnelStatus ?? null,
    availableEnterprises: enterprises,
    enterpriseAliases: aliases,
  };
  return JSON.stringify(payload, null, 2);
}

function classifierSystemPrompt(): string {
  return [
    'Você é um classificador comercial da plataforma Quero Meu Apê.',
    'Sua tarefa é analisar a conversa entre cliente e Ana e classificar:',
    '- temperatura do lead',
    '- empreendimento de interesse',
    '- etapa/funil comercial',
    '- intenção principal',
    'Você NÃO deve responder ao cliente.',
    'Você NÃO deve criar texto de atendimento.',
    'Você deve devolver apenas JSON válido.',
    '',
    'Critérios de temperatura:',
    'Frio: saudação, curiosidade inicial, intenção pouco clara, pergunta genérica.',
    'Morno: interesse por empreendimento, localização, preço, metragem, disponibilidade, lote/terreno, financiamento, formas de pagamento.',
    'Quente: visita, corretor, simulação, urgência, reserva, compra, próximo passo concreto.',
    '',
    'Empreendimento:',
    '- Escolha somente entre os empreendimentos disponíveis recebidos na entrada.',
    '- Considere variações e erros de digitação.',
    '- Se confiança insuficiente, retorne enterpriseId=null e enterpriseName=null.',
    '',
    'Saída obrigatória em JSON:',
    '{',
    '  "temperature": "Frio" | "Morno" | "Quente",',
    '  "temperatureConfidence": number de 0.0 a 1.0,',
    '  "temperatureReason": "string curta",',
    '  "enterpriseId": number | null,',
    '  "enterpriseName": string | null,',
    '  "enterpriseConfidence": number de 0.0 a 1.0,',
    '  "enterpriseReason": "string curta",',
    '  "funnelStatus": "Novo" | "Qualificado" | "Em atendimento" | "Agendado" | null,',
    '  "funnelConfidence": number de 0.0 a 1.0,',
    '  "mainIntent": "saudacao" | "informacoes_gerais" | "preco" | "disponibilidade" | "localizacao" | "metragem" | "visita" | "simulacao" | "corretor" | "material" | "outro",',
    '  "shouldUpdateTemperature": boolean,',
    '  "shouldUpdateEnterprise": boolean,',
    '  "shouldUpdateFunnel": boolean',
    '}',
    'Retorne somente JSON puro, sem markdown.',
  ].join('\n');
}

function stripCodeFence(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('```')) {
    const noStart = trimmed.replace(/^```[a-zA-Z]*\s*/,'');
    return noStart.replace(/\s*```$/, '').trim();
  }
  return trimmed;
}

function tryParseClassifierJson(rawContent: string): Record<string, unknown> | null {
  const raw = stripCodeFence(rawContent);
  try {
    const obj = JSON.parse(raw) as unknown;
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) return obj as Record<string, unknown>;
  } catch {
    // ignore
  }
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) {
    const chunk = raw.slice(start, end + 1);
    try {
      const obj = JSON.parse(chunk) as unknown;
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) return obj as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return null;
}

function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[] = new Array(n + 1);
  for (let j = 0; j <= n; j += 1) dp[j] = j;
  for (let i = 1; i <= m; i += 1) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const temp = dp[j]!;
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[j] = Math.min(
        dp[j]! + 1,
        dp[j - 1]! + 1,
        prev + cost
      );
      prev = temp;
    }
  }
  return dp[n]!;
}

function resolveEnterpriseIdFromName(
  name: string,
  enterprises: EnterpriseRow[],
  aliasRows: EnterpriseAliasRowInput[]
): number | null {
  const normalizedName = normalizeEnterpriseAliasText(name);
  if (!normalizedName) return null;
  const compactName = compactText(normalizedName);

  const candidates: Array<{ enterpriseId: number; normalized: string }> = [];
  for (const enterprise of enterprises) {
    candidates.push({ enterpriseId: enterprise.id, normalized: normalizeEnterpriseAliasText(enterprise.name) });
    candidates.push({ enterpriseId: enterprise.id, normalized: normalizeEnterpriseAliasText(enterprise.slug || '') });
  }
  for (const row of aliasRows) {
    candidates.push({
      enterpriseId: row.enterprise_id,
      normalized: normalizeEnterpriseAliasText(row.normalized_alias || row.alias || ''),
    });
  }

  const exactMatches = new Set<number>();
  for (const candidate of candidates) {
    if (!candidate.normalized) continue;
    const candidateCompact = compactText(candidate.normalized);
    if (!candidateCompact) continue;
    if (candidateCompact === compactName) exactMatches.add(candidate.enterpriseId);
    else if (
      candidateCompact.length >= 5 &&
      (compactName.includes(candidateCompact) || candidateCompact.includes(compactName))
    ) {
      exactMatches.add(candidate.enterpriseId);
    }
  }
  if (exactMatches.size === 1) return Array.from(exactMatches)[0] ?? null;
  if (exactMatches.size > 1) return null;

  let bestId: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  let tie = false;
  for (const candidate of candidates) {
    if (!candidate.normalized) continue;
    const candidateCompact = compactText(candidate.normalized);
    if (candidateCompact.length < 5 || compactName.length < 5) continue;
    const distance = levenshteinDistance(compactName, candidateCompact);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestId = candidate.enterpriseId;
      tie = false;
    } else if (distance === bestDistance && bestId !== candidate.enterpriseId) {
      tie = true;
    }
  }
  if (!tie && bestId != null && bestDistance <= 2) return bestId;
  return null;
}

function safeFallbackDecision(input: ClassifyLeadConversationInput, reason: string): LeadClassifierDecision {
  const currentTemperature = normalizeCurrentTemperature(input.currentTemperature);
  const shouldInitFrio = currentTemperature == null && !input.manualOverrideFlags.temperature;
  return {
    temperature: currentTemperature ?? 'Frio',
    temperatureConfidence: 0,
    temperatureReason: currentTemperature ? 'fallback_keep_current_temperature' : 'fallback_default_frio',
    enterpriseId: input.currentEnterpriseId ?? null,
    enterpriseName: null,
    enterpriseConfidence: 0,
    enterpriseReason: 'fallback_keep_current_enterprise',
    funnelStatus: normalizeFunnelStatus(input.currentFunnelStatus),
    funnelConfidence: 0,
    mainIntent: 'outro',
    shouldUpdateTemperature: shouldInitFrio,
    shouldUpdateEnterprise: false,
    shouldUpdateFunnel: false,
    source: 'fallback',
    ignoredReasons: [reason],
    classifierError: reason,
    rawClassifierJson: null,
  };
}

function applyGuardrails(
  base: LeadClassifierDecision,
  input: ClassifyLeadConversationInput
): LeadClassifierDecision {
  const ignoredReasons = [...base.ignoredReasons];
  const currentTemperature = normalizeCurrentTemperature(input.currentTemperature);
  const currentRank = currentTemperature ? TEMP_RANK[currentTemperature] : null;
  const nextRank = TEMP_RANK[base.temperature];
  const userMessagesOnly = input.recentMessages
    .filter((item) => item.role === 'user')
    .map((item) => item.content);
  const latestMessage = input.latestCustomerMessage || '';
  const hasCoolingEvidence = hasClearCoolingEvidence(userMessagesOnly);
  const isNeutralShort = isNeutralShortMessage(latestMessage);

  let shouldUpdateTemperature = base.shouldUpdateTemperature;
  let shouldUpdateEnterprise = base.shouldUpdateEnterprise;
  let shouldUpdateFunnel = base.shouldUpdateFunnel;
  let temperature = base.temperature;
  let enterpriseId = base.enterpriseId;
  let enterpriseName = base.enterpriseName;
  let funnelStatus = base.funnelStatus;

  if (base.temperatureConfidence < 0.65) {
    if (currentTemperature == null && !input.manualOverrideFlags.temperature) {
      temperature = 'Frio';
      shouldUpdateTemperature = true;
      ignoredReasons.push('temperature_low_confidence_defaulted_to_frio');
    } else {
      shouldUpdateTemperature = false;
      ignoredReasons.push('temperature_low_confidence');
    }
  }

  if (input.manualOverrideFlags.temperature) {
    shouldUpdateTemperature = false;
    ignoredReasons.push('temperature_manual_override');
  }

  if (currentRank != null && nextRank < currentRank) {
    if ((currentTemperature === 'Quente' && temperature === 'Frio' && !hasCoolingEvidence) || isNeutralShort) {
      shouldUpdateTemperature = false;
      ignoredReasons.push('temperature_reduction_blocked_neutral_or_without_clear_evidence');
    }
    if (currentTemperature === 'Quente' && temperature === 'Frio' && userMessagesOnly.length <= 1) {
      shouldUpdateTemperature = false;
      ignoredReasons.push('temperature_quente_to_frio_blocked_single_message');
    }
  }

  const enterprisesById = new Map(input.availableEnterprises.map((enterprise) => [enterprise.id, enterprise]));
  if (enterpriseId != null && !enterprisesById.has(enterpriseId)) {
    enterpriseId = null;
    enterpriseName = null;
    shouldUpdateEnterprise = false;
    ignoredReasons.push('enterprise_id_not_found_in_available_enterprises');
  }

  if (enterpriseId == null && enterpriseName) {
    const resolvedId = resolveEnterpriseIdFromName(
      enterpriseName,
      input.availableEnterprises,
      input.enterpriseAliasRows
    );
    if (resolvedId != null) {
      enterpriseId = resolvedId;
      enterpriseName = enterprisesById.get(resolvedId)?.name ?? enterpriseName;
    } else {
      enterpriseName = null;
      shouldUpdateEnterprise = false;
      ignoredReasons.push('enterprise_name_without_valid_enterprise_id');
    }
  }

  if (base.enterpriseConfidence < 0.75) {
    shouldUpdateEnterprise = false;
    ignoredReasons.push('enterprise_low_confidence');
  }
  if (input.manualOverrideFlags.enterprise) {
    shouldUpdateEnterprise = false;
    ignoredReasons.push('enterprise_manual_override');
  }
  if (enterpriseId == null) {
    shouldUpdateEnterprise = false;
  }

  const currentFunnel = normalizeText(input.currentFunnelStatus || '');
  if (currentFunnel === 'handoff' || currentFunnel === 'carteira') {
    shouldUpdateFunnel = false;
    ignoredReasons.push('funnel_protected_current_status');
  }
  if (funnelStatus != null && !SUPPORTED_FUNNEL.includes(funnelStatus)) {
    shouldUpdateFunnel = false;
    funnelStatus = null;
    ignoredReasons.push('funnel_status_not_supported');
  }
  if (base.funnelConfidence < 0.65) {
    shouldUpdateFunnel = false;
    ignoredReasons.push('funnel_low_confidence');
  }
  if (funnelStatus == null) {
    shouldUpdateFunnel = false;
  }

  return {
    ...base,
    temperature,
    enterpriseId,
    enterpriseName,
    funnelStatus,
    shouldUpdateTemperature,
    shouldUpdateEnterprise,
    shouldUpdateFunnel,
    ignoredReasons,
  };
}

function normalizeRawClassifierOutput(
  input: ClassifyLeadConversationInput,
  raw: Record<string, unknown>,
  rawJson: string
): LeadClassifierDecision {
  const temperature = titleCaseTemperature(String(raw.temperature ?? '')) ?? 'Frio';
  const temperatureConfidence = clamp01(raw.temperatureConfidence);
  const enterpriseConfidence = clamp01(raw.enterpriseConfidence);
  const funnelConfidence = clamp01(raw.funnelConfidence);
  const enterpriseId = parseEnterpriseId(raw.enterpriseId);
  const enterpriseName = typeof raw.enterpriseName === 'string' && raw.enterpriseName.trim()
    ? raw.enterpriseName.trim().slice(0, 180)
    : null;
  const decision: LeadClassifierDecision = {
    temperature,
    temperatureConfidence,
    temperatureReason: toShortReason(raw.temperatureReason, 'ai_temperature_reason_missing'),
    enterpriseId,
    enterpriseName,
    enterpriseConfidence,
    enterpriseReason: toShortReason(raw.enterpriseReason, 'ai_enterprise_reason_missing'),
    funnelStatus: normalizeFunnelStatus(raw.funnelStatus),
    funnelConfidence,
    mainIntent: normalizeMainIntent(raw.mainIntent),
    shouldUpdateTemperature: parseBoolean(raw.shouldUpdateTemperature),
    shouldUpdateEnterprise: parseBoolean(raw.shouldUpdateEnterprise),
    shouldUpdateFunnel: parseBoolean(raw.shouldUpdateFunnel),
    source: 'ai',
    ignoredReasons: [],
    classifierError: null,
    rawClassifierJson: rawJson,
  };
  return applyGuardrails(decision, input);
}

export async function classifyLeadConversation(
  input: ClassifyLeadConversationInput,
  deps?: Partial<LeadClassifierDependencies>
): Promise<LeadClassifierDecision> {
  const mergedDeps: LeadClassifierDependencies = {
    ...DEFAULT_DEPS,
    ...(deps || {}),
  };
  const aiConfig = await mergedDeps.loadOpenAIConfig(input.currentEnterpriseId ?? null);
  if (!aiConfig?.openaiApiKey?.trim()) {
    return safeFallbackDecision(input, aiConfig?.blockedReason ?? 'openai_api_key_not_configured');
  }

  const baseUrl = aiConfig.openaiBaseUrl ?? null;
  const model = (aiConfig.modelColdLead || aiConfig.modelHotLead || 'gpt-4.1-mini').trim();
  const promptInput = buildPromptInputPayload(input);

  let result: GenerateCompletionResult;
  try {
    result = await mergedDeps.generateCompletion({
      apiKey: aiConfig.openaiApiKey,
      baseUrl,
      model,
      temperature: 0.1,
      maxTokens: Math.max(450, Math.min(aiConfig.maxTokens || 700, 1200)),
      responseFormatJson: true,
      messages: [
        { role: 'system', content: classifierSystemPrompt() },
        { role: 'user', content: `Entrada para classificar:\n${promptInput}` },
      ],
      costTracking: aiConfig.costTrackingEnabled === false
        ? undefined
        : {
            purpose: 'lead_classifier',
            modelReason: 'lead_classification_pipeline',
            conversationId: input.conversationId,
            contactId: input.contactId ?? null,
            enterpriseId: input.currentEnterpriseId ?? null,
            apiKeySource: aiConfig.apiKeySource,
            openaiApiKeyId: aiConfig.openaiApiKeyId ?? null,
            openaiProjectId: aiConfig.openaiProjectId ?? null,
            requestType: 'lead_classifier',
            metadata: {
              classificationLayer: 'whatsapp_inbound',
            },
          },
    });
  } catch (error) {
    return safeFallbackDecision(
      input,
      `classifier_request_failed:${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (!result.success || !result.content) {
    return safeFallbackDecision(input, `classifier_provider_error:${result.error || 'unknown_error'}`);
  }

  const parsed = tryParseClassifierJson(result.content);
  if (!parsed) {
    const fallback = safeFallbackDecision(input, 'classifier_invalid_json');
    fallback.rawClassifierJson = result.content.slice(0, 1200);
    return fallback;
  }

  return normalizeRawClassifierOutput(input, parsed, result.content);
}
