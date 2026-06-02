export interface AnaBudgetChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AnaTokenBudgetConfig {
  auditEnabled: boolean;
  targetInputTokens: number;
  warnInputTokens: number;
  shrinkInputTokens: number;
  blockInputTokens: number;
  disableSameContextRetryAbove: number;
  priceMissingNoLlm: boolean;
  maxOutputTokens: number;
  ragMaxChunks: number;
  recentMessagesMax: number;
}

export type AnaTokenBudgetLevel = 'ok' | 'warn' | 'shrink' | 'block';

export interface AnaTokenBudgetDecision {
  estimatedInputTokens: number;
  level: AnaTokenBudgetLevel;
  shouldWarn: boolean;
  shouldShrink: boolean;
  shouldBlock: boolean;
}

export type AnaCommercialNoLlmIntent =
  | 'price'
  | 'down_payment'
  | 'installment'
  | 'simulation'
  | 'discount'
  | 'commercial_table'
  | 'custom_condition'
  | 'specific_availability'
  | 'specific_lot';

function readIntEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

function readBoolEnv(name: string, fallback: boolean): boolean {
  const raw = String(process.env[name] ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'sim';
}

export function getAnaTokenBudgetConfig(): AnaTokenBudgetConfig {
  return {
    auditEnabled: readBoolEnv('ANA_TOKEN_AUDIT_ENABLED', true),
    targetInputTokens: readIntEnv('ANA_TARGET_INPUT_TOKENS', 1500),
    warnInputTokens: readIntEnv('ANA_WARN_INPUT_TOKENS', 3000),
    shrinkInputTokens: readIntEnv('ANA_SHRINK_INPUT_TOKENS', 4000),
    blockInputTokens: readIntEnv('ANA_BLOCK_INPUT_TOKENS', 5000),
    disableSameContextRetryAbove: readIntEnv('ANA_DISABLE_SAME_CONTEXT_RETRY_ABOVE', 3500),
    priceMissingNoLlm: readBoolEnv('ANA_PRICE_MISSING_NO_LLM', true),
    maxOutputTokens: readIntEnv('ANA_MAX_OUTPUT_TOKENS', 220),
    ragMaxChunks: readIntEnv('ANA_RAG_MAX_CHUNKS', 3),
    recentMessagesMax: readIntEnv('ANA_RECENT_MESSAGES_MAX', 8),
  };
}

export function estimateTextTokens(text: string | null | undefined): number {
  const normalized = String(text ?? '').trim();
  if (!normalized) return 0;
  return Math.ceil(normalized.length / 3.6);
}

export function estimateChatInputTokens(messages: readonly AnaBudgetChatMessage[]): number {
  const messageOverhead = messages.length * 8 + 12;
  return messageOverhead + messages.reduce((total, message) => total + estimateTextTokens(message.content), 0);
}

export function evaluateAnaTokenBudget(
  messages: readonly AnaBudgetChatMessage[],
  config = getAnaTokenBudgetConfig()
): AnaTokenBudgetDecision {
  const estimatedInputTokens = estimateChatInputTokens(messages);
  const level: AnaTokenBudgetLevel =
    estimatedInputTokens > config.blockInputTokens
      ? 'block'
      : estimatedInputTokens > config.shrinkInputTokens
        ? 'shrink'
        : estimatedInputTokens > config.warnInputTokens
          ? 'warn'
          : 'ok';
  return {
    estimatedInputTokens,
    level,
    shouldWarn: estimatedInputTokens > config.warnInputTokens,
    shouldShrink: estimatedInputTokens > config.shrinkInputTokens,
    shouldBlock: estimatedInputTokens > config.blockInputTokens,
  };
}

function norm(text: string | null | undefined): string {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function detectAnaCommercialSpecificNoLlmIntent(
  userMessage: string | null | undefined
): AnaCommercialNoLlmIntent | null {
  const text = norm(userMessage);
  if (!text) return null;
  if (/\b(tabela comercial|manda a tabela|me manda a tabela|envia a tabela|tabela de precos|tabela de valores)\b/.test(text)) {
    return 'commercial_table';
  }
  if (/\b(simulacao|simular|faz uma simulacao|consegue simular|pre simulacao|cenario financeiro)\b/.test(text)) {
    return 'simulation';
  }
  if (/\b(desconto|negociar|negocia|condicao especial)\b/.test(text)) {
    return 'discount';
  }
  if (/\b(condicao personalizada|condicoes personalizadas|parcela personalizada|fluxo personalizado)\b/.test(text)) {
    return 'custom_condition';
  }
  if (/\b(entrada|sinal|quanto preciso dar de entrada|entrada minima)\b/.test(text)) {
    return 'down_payment';
  }
  if (/\b(parcela|parcelas|quanto fica por mes|mensalidade|prazo|juros)\b/.test(text)) {
    return 'installment';
  }
  if (
    /\b(lote especifico|unidade especifica|quadra|lote \d+|unidade \d+|qual lote|quais lotes|lotes disponiveis|disponibilidade especifica|tem disponivel)\b/.test(
      text
    )
  ) {
    return 'specific_lot';
  }
  if (/\b(disponibilidade|unidades disponiveis|tem unidade)\b/.test(text)) return 'specific_availability';
  if (/\b(valor|preco|quanto custa|quanto e|a partir de quanto|investimento)\b/.test(text)) return 'price';
  return null;
}

export function isCommercialNoLlmIntentAlwaysSensitive(intent: AnaCommercialNoLlmIntent): boolean {
  return (
    intent === 'down_payment' ||
    intent === 'installment' ||
    intent === 'simulation' ||
    intent === 'discount' ||
    intent === 'commercial_table' ||
    intent === 'custom_condition' ||
    intent === 'specific_availability' ||
    intent === 'specific_lot'
  );
}

function pickVariation(seed: string, options: readonly string[]): string {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return options[hash % options.length] ?? options[0] ?? '';
}

export function buildAnaCommercialSpecificNoLlmReply(args: {
  intent: AnaCommercialNoLlmIntent;
  userMessage: string;
  hasSendableBook?: boolean;
}): string {
  if (args.intent === 'commercial_table') {
    if (args.hasSendableBook) {
      return 'A tabela comercial não é enviada por aqui. Posso te enviar o Book autorizado do empreendimento ou encaminhar para o corretor te passar as condições certinhas.';
    }
    return 'A tabela comercial não é enviada por aqui. O corretor te passa valores e disponibilidade atualizados certinho. Quer que eu encaminhe ou te ajude a marcar uma visita?';
  }

  const variations = [
    'Esses detalhes variam conforme as opções disponíveis. O corretor te passa tudo certinho no atendimento. Que tal marcarmos uma visita?',
    'Esse ponto depende da unidade e das condições atualizadas. Posso te encaminhar para o corretor responsável ou te ajudar a agendar uma visita.',
    'Para esse detalhe comercial, o ideal é validar direto com o corretor para não te passar informação imprecisa. Posso te ajudar a marcar uma visita?',
  ];
  return pickVariation(`${args.intent}:${args.userMessage}`, variations);
}

