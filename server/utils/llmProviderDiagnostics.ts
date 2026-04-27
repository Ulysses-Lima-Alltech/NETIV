export type LlmProvider = 'openai' | 'openrouter' | 'local' | 'mock' | 'unknown';

export type LlmClassifiedError =
  | 'OPENAI_INSUFFICIENT_QUOTA_OR_BILLING'
  | 'OPENAI_RATE_LIMIT'
  | 'OPENAI_AUTH_ERROR'
  | 'OPENAI_MODEL_NOT_FOUND'
  | 'OPENAI_CONTEXT_LENGTH'
  | 'OPENAI_BAD_REQUEST'
  | 'OPENAI_TIMEOUT_OR_NETWORK'
  | 'RAG_NO_ENTERPRISE_LINK'
  | 'RAG_NO_ACTIVE_FILES'
  | 'RAG_NO_RELEVANT_CHUNKS'
  | 'RAG_RETRIEVAL_ERROR'
  | 'UNKNOWN_LLM_ERROR'
  | 'UNKNOWN_RUNTIME_ERROR';

export interface ClassifiedLlmError {
  provider: LlmProvider;
  classifiedError: LlmClassifiedError;
  sanitizedMessage: string;
  httpStatus: number | null;
  providerErrorCode: string | null;
  providerErrorType: string | null;
  canGenerate: boolean;
  recommendation: string;
}

export function detectLlmProvider(baseUrl: string | null | undefined): LlmProvider {
  const raw = String(baseUrl ?? '').trim().toLowerCase();
  if (!raw) return 'openai';
  if (raw.includes('openrouter.ai')) return 'openrouter';
  if (
    raw.includes('localhost') ||
    raw.includes('127.0.0.1') ||
    raw.includes('0.0.0.0') ||
    raw.includes('host.docker.internal')
  ) {
    return 'local';
  }
  if (raw.includes('mock')) return 'mock';
  if (raw.includes('openai.com')) return 'openai';
  return 'unknown';
}

function collapseWhitespace(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

function stripJsonPayloads(input: string): string {
  return input
    .replace(/\{[\s\S]*\}/g, '[json omitted]')
    .replace(/\[[\s\S]*\]/g, '[list omitted]');
}

function redactSecrets(input: string): string {
  return input
    .replace(/authorization\s*:\s*bearer\s+[a-z0-9._\-]+/gi, 'authorization: [redacted]')
    .replace(/bearer\s+[a-z0-9._\-]+/gi, 'Bearer [redacted]')
    .replace(/(sk|rk)-[a-z0-9_-]{12,}/gi, '[redacted-key]')
    .replace(/api[_-]?key[^,\s:]*(?:\s*[:=]\s*|\s+)[^\s,;]+/gi, 'api_key=[redacted]')
    .replace(/authorization[^,\n]*/gi, 'authorization=[redacted]')
    .replace(/https?:\/\/[^\s]+/gi, (url) => {
      try {
        const parsed = new URL(url);
        return `${parsed.origin}${parsed.pathname}`;
      } catch {
        return '[redacted-url]';
      }
    });
}

export function sanitizeProviderErrorMessage(message: string | null | undefined): string {
  const raw = String(message ?? '').trim();
  if (!raw) return 'Erro não detalhado do provider.';
  const sanitized = collapseWhitespace(redactSecrets(stripJsonPayloads(raw)));
  return sanitized.slice(0, 400) || 'Erro não detalhado do provider.';
}

function lower(input: string | null | undefined): string {
  return String(input ?? '').trim().toLowerCase();
}

function isQuotaOrBillingLike(text: string): boolean {
  return (
    text.includes('insufficient_quota') ||
    text.includes('billing') ||
    text.includes('quota') ||
    text.includes('credits') ||
    text.includes('credit') ||
    text.includes('exceeded your current quota')
  );
}

function isTimeoutOrNetworkLike(text: string): boolean {
  return (
    text.includes('timeout') ||
    text.includes('timed out') ||
    text.includes('abort') ||
    text.includes('aborted') ||
    text.includes('econnreset') ||
    text.includes('etimedout') ||
    text.includes('enotfound') ||
    text.includes('fetch failed') ||
    text.includes('network') ||
    text.includes('socket hang up')
  );
}

function recommendationFor(classifiedError: LlmClassifiedError): string {
  switch (classifiedError) {
    case 'OPENAI_INSUFFICIENT_QUOTA_OR_BILLING':
      return 'Verifique créditos, faturamento e limites da conta OpenAI antes de reativar a automação.';
    case 'OPENAI_AUTH_ERROR':
      return 'Revise a API key, permissões da conta e a base URL configurada para a Ana.';
    case 'OPENAI_RATE_LIMIT':
      return 'Aguarde a janela de limite ou reduza volume/concurrency antes de tentar novamente.';
    case 'OPENAI_MODEL_NOT_FOUND':
      return 'Confirme se o modelo configurado existe e está disponível para a conta atual.';
    case 'OPENAI_CONTEXT_LENGTH':
      return 'Reduza contexto/tokens do prompt ou troque para um modelo com janela maior.';
    case 'OPENAI_BAD_REQUEST':
      return 'Revise payload, parâmetros do modelo e compatibilidade da endpoint chamada.';
    case 'OPENAI_TIMEOUT_OR_NETWORK':
      return 'Verifique conectividade, DNS, timeout e disponibilidade do provider.';
    case 'RAG_NO_ENTERPRISE_LINK':
      return 'Confirme se a conversa está vinculada ao empreendimento correto antes de responder pela Ana.';
    case 'RAG_NO_ACTIVE_FILES':
      return 'Confirme se o empreendimento possui arquivos ativos e habilitados para conhecimento.';
    case 'RAG_NO_RELEVANT_CHUNKS':
      return 'Reveja a ingestão/chunking da base e se os documentos certos estão vinculados ao empreendimento.';
    case 'RAG_RETRIEVAL_ERROR':
      return 'Investigue a consulta de chunks e a integridade das versões/arquivos do conhecimento.';
    case 'UNKNOWN_RUNTIME_ERROR':
      return 'Revise logs internos e o fluxo do servidor para identificar a falha não classificada.';
    case 'UNKNOWN_LLM_ERROR':
    default:
      return 'Revise o erro sanitizado e a resposta do provider para classificar a falha com mais precisão.';
  }
}

export function classifyLlmProviderError(input: {
  provider?: LlmProvider | null;
  httpStatus?: number | null;
  providerErrorCode?: string | null;
  providerErrorType?: string | null;
  message?: string | null;
}): ClassifiedLlmError {
  const provider = input.provider ?? 'openai';
  const httpStatus = input.httpStatus ?? null;
  const providerErrorCode = input.providerErrorCode?.trim() || null;
  const providerErrorType = input.providerErrorType?.trim() || null;
  const sanitizedMessage = sanitizeProviderErrorMessage(input.message);
  const combined = lower([sanitizedMessage, providerErrorCode, providerErrorType].filter(Boolean).join(' | '));

  let classifiedError: LlmClassifiedError = 'UNKNOWN_LLM_ERROR';
  let canGenerate = false;

  if (httpStatus === 401 || httpStatus === 403) {
    classifiedError = 'OPENAI_AUTH_ERROR';
  } else if (httpStatus === 429 && isQuotaOrBillingLike(combined)) {
    classifiedError = 'OPENAI_INSUFFICIENT_QUOTA_OR_BILLING';
  } else if (httpStatus === 429) {
    classifiedError = 'OPENAI_RATE_LIMIT';
  } else if (httpStatus === 404 || combined.includes('model_not_found')) {
    classifiedError = 'OPENAI_MODEL_NOT_FOUND';
  } else if (combined.includes('context_length_exceeded') || combined.includes('maximum context length')) {
    classifiedError = 'OPENAI_CONTEXT_LENGTH';
  } else if (isTimeoutOrNetworkLike(combined)) {
    classifiedError = 'OPENAI_TIMEOUT_OR_NETWORK';
  } else if (httpStatus === 400) {
    classifiedError = 'OPENAI_BAD_REQUEST';
  } else if (!combined) {
    classifiedError = 'UNKNOWN_RUNTIME_ERROR';
  }

  if (classifiedError === 'OPENAI_RATE_LIMIT' || classifiedError === 'OPENAI_TIMEOUT_OR_NETWORK') {
    canGenerate = false;
  }

  return {
    provider,
    classifiedError,
    sanitizedMessage,
    httpStatus,
    providerErrorCode,
    providerErrorType,
    canGenerate,
    recommendation: recommendationFor(classifiedError),
  };
}
