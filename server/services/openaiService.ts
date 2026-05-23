import {
  classifyLlmProviderError,
  detectLlmProvider,
  sanitizeProviderErrorMessage,
  type LlmClassifiedError,
  type LlmProvider,
} from '../utils/llmProviderDiagnostics.js';
import {
  estimateLlmCostUsd,
  type LlmModelPrice,
} from '../utils/llmCost.js';
import {
  insertLlmUsageEvent,
  type LlmUsageEventInput,
} from '../repositories/llmUsageRepository.js';

const REQUEST_TIMEOUT_MS = 30000;

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface GenerateCompletionParams {
  apiKey: string;
  baseUrl: string | null;
  model: string;
  messages: ChatMessage[];
  temperature: number;
  maxTokens: number;
  /** Forca saida JSON (modelos com suporte a `response_format`). */
  responseFormatJson?: boolean;
  costTracking?: {
    purpose: string;
    modelReason?: string | null;
    apiKeySource?: 'enterprise' | 'global_fallback' | null;
    openaiApiKeyId?: string | null;
    openaiProjectId?: string | null;
    requestType?: string | null;
    conversationId?: number | null;
    contactId?: number | null;
    enterpriseId?: number | null;
    inboundMessageId?: number | null;
    outboundMessageId?: number | null;
    metadata?: Record<string, unknown>;
    recordUsageEvent?: (event: LlmUsageEventInput) => Promise<void>;
  };
}

export interface GenerateCompletionResult {
  success: boolean;
  content?: string;
  error?: string;
  /** Status HTTP quando a API retornou corpo de erro (diagnostico). */
  httpStatus?: number;
  provider?: LlmProvider;
  model?: string;
  errorCode?: string | null;
  errorType?: string | null;
  classifiedError?: LlmClassifiedError | null;
  usage?: {
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  estimatedCostUsd?: number;
}

export function usesMaxCompletionTokens(model: string): boolean {
  const normalized = String(model || '').trim().toLowerCase();
  if (!normalized) return false;
  if (normalized.startsWith('o3')) return true;
  if (normalized.startsWith('o4')) return true;
  if (normalized.startsWith('gpt-5')) return true;
  return false;
}

type ChatCompletionUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  completion_tokens_details?: {
    reasoning_tokens?: number;
  };
  prompt_tokens_details?: {
    cached_tokens?: number;
  };
};

type ChatCompletionApiResponse = {
  choices?: Array<{ message?: { content?: string }; finish_reason?: string | null }>;
  usage?: ChatCompletionUsage;
  error?: { message?: string; code?: string; type?: string; param?: string };
};

function numberOrZero(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

function parseUsage(usage: ChatCompletionUsage | undefined): NonNullable<GenerateCompletionResult['usage']> {
  const inputTokens = numberOrZero(usage?.prompt_tokens);
  const outputTokens = numberOrZero(usage?.completion_tokens);
  const totalTokens = numberOrZero(usage?.total_tokens) || inputTokens + outputTokens;
  const cachedInputTokens = Math.min(
    numberOrZero(usage?.prompt_tokens_details?.cached_tokens),
    inputTokens
  );
  return { inputTokens, cachedInputTokens, outputTokens, totalTokens };
}

async function recordLlmUsage(params: {
  tracking: GenerateCompletionParams['costTracking'];
  provider: LlmProvider;
  model: string;
  usage: NonNullable<GenerateCompletionResult['usage']>;
  success: boolean;
  errorCode?: string | null;
  latencyMs: number;
  requestId?: string | null;
  httpStatus?: number | null;
  price?: LlmModelPrice | null;
  priceMissing: boolean;
  estimatedCostUsd: number;
}): Promise<void> {
  if (!params.tracking) return;
  const recorder = params.tracking.recordUsageEvent ?? insertLlmUsageEvent;
  const metadata = {
    ...(params.tracking.metadata ?? {}),
    httpStatus: params.httpStatus ?? null,
    priceMissing: params.priceMissing,
    price: params.price
      ? {
          inputUsdPer1M: params.price.inputUsdPer1M,
          cachedInputUsdPer1M: params.price.cachedInputUsdPer1M ?? null,
          outputUsdPer1M: params.price.outputUsdPer1M,
        }
      : null,
  };
  try {
    await recorder({
      provider: params.provider,
      model: params.model,
      apiKeySource: params.tracking.apiKeySource ?? null,
      openaiApiKeyId: params.tracking.openaiApiKeyId ?? null,
      openaiProjectId: params.tracking.openaiProjectId ?? null,
      requestType: params.tracking.requestType ?? null,
      purpose: params.tracking.purpose,
      modelReason: params.tracking.modelReason ?? null,
      conversationId: params.tracking.conversationId ?? null,
      contactId: params.tracking.contactId ?? null,
      enterpriseId: params.tracking.enterpriseId ?? null,
      inboundMessageId: params.tracking.inboundMessageId ?? null,
      outboundMessageId: params.tracking.outboundMessageId ?? null,
      inputTokens: params.usage.inputTokens,
      cachedInputTokens: params.usage.cachedInputTokens,
      outputTokens: params.usage.outputTokens,
      totalTokens: params.usage.totalTokens,
      estimatedCostUsd: params.estimatedCostUsd,
      success: params.success,
      errorCode: params.errorCode ?? null,
      latencyMs: params.latencyMs,
      requestId: params.requestId ?? null,
      metadata,
    });
  } catch (error) {
    console.error('[LLM_USAGE_EVENT_INSERT_FAILED]', {
      provider: params.provider,
      model: params.model,
      purpose: params.tracking.purpose,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function generateChatCompletion(params: GenerateCompletionParams): Promise<GenerateCompletionResult> {
  let { apiKey, baseUrl, model, messages, temperature, maxTokens, responseFormatJson } = params;

  const localLlmEnabled = String(process.env.ANA_LOCAL_LLM_ENABLED || '').trim().toLowerCase() === 'true';

  if (localLlmEnabled) {
    apiKey = process.env.ANA_LOCAL_LLM_API_KEY || 'ollama';
    baseUrl = process.env.ANA_LOCAL_LLM_BASE_URL || 'http://localhost:11434/v1';
    model = process.env.ANA_LOCAL_LLM_MODEL || model;
    temperature = Number(process.env.ANA_LOCAL_LLM_TEMPERATURE || temperature || 0.2);
    maxTokens = Number(process.env.ANA_LOCAL_LLM_MAX_TOKENS || maxTokens || 800);

    console.log('[ANA_LOCAL_LLM_OVERRIDE]', {
      enabled: true,
      baseUrl,
      model,
      temperature,
      maxTokens,
    });
  }
  const url = (baseUrl?.trim() || 'https://api.openai.com/v1').replace(/\/$/, '') + '/chat/completions';
  const provider = detectLlmProvider(baseUrl);
  const startedAt = Date.now();

  const controller = new AbortController();
  const requestTimeoutMs = localLlmEnabled
    ? Number(process.env.ANA_LOCAL_LLM_TIMEOUT_MS || 120000)
    : REQUEST_TIMEOUT_MS;
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

  const usesMaxCompletionTokensOnly = usesMaxCompletionTokens(model);
  const body: Record<string, unknown> = {
    model,
    messages,
  };
  if (responseFormatJson) {
    body.response_format = { type: 'json_object' };
  }
  let reasoningEffort: 'minimal' | null = null;
  if (usesMaxCompletionTokensOnly) {
    body.max_completion_tokens = maxTokens;
    if (String(model || '').trim().toLowerCase().startsWith('gpt-5')) {
      body.reasoning_effort = 'minimal';
      reasoningEffort = 'minimal';
    }
  } else {
    body.temperature = temperature;
    body.max_tokens = maxTokens;
  }
  console.log('[OPENAI_REQUEST_PARAMS]', {
    model,
    tokenParam: usesMaxCompletionTokensOnly ? 'max_completion_tokens' : 'max_tokens',
    reasoningEffort,
    maxTokens,
    messagesCount: messages.length,
  });

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    const data = (await res.json()) as ChatCompletionApiResponse;
    const requestId = res.headers.get('x-request-id') ?? res.headers.get('openai-request-id');
    const usage = parseUsage(data.usage);
    const cost = estimateLlmCostUsd({
      model,
      inputTokens: usage.inputTokens,
      cachedInputTokens: usage.cachedInputTokens,
      outputTokens: usage.outputTokens,
    });

    if (!res.ok) {
      const e = data.error;
      const classified = classifyLlmProviderError({
        provider,
        httpStatus: res.status,
        providerErrorCode: e?.code ?? null,
        providerErrorType: e?.type ?? null,
        message: e?.message ?? `Erro HTTP ${res.status}`,
      });
      console.error('[OpenAI] API error', {
        status: res.status,
        message: classified.sanitizedMessage,
        model,
        provider,
        classifiedError: classified.classifiedError,
      });
      await recordLlmUsage({
        tracking: params.costTracking,
        provider,
        model,
        usage,
        success: false,
        errorCode: classified.providerErrorCode ?? classified.classifiedError,
        latencyMs: Date.now() - startedAt,
        requestId,
        httpStatus: res.status,
        price: cost.price,
        priceMissing: cost.priceMissing,
        estimatedCostUsd: cost.estimatedCostUsd,
      });
      return {
        success: false,
        error: classified.sanitizedMessage,
        httpStatus: res.status,
        provider,
        model,
        errorCode: classified.providerErrorCode,
        errorType: classified.providerErrorType,
        classifiedError: classified.classifiedError,
        usage,
        estimatedCostUsd: cost.estimatedCostUsd,
      };
    }

    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) {
      const preview = JSON.stringify(data).slice(0, 600);
      const finishReason = data.choices?.[0]?.finish_reason ?? null;
      const reasoningTokens = numberOrZero(data.usage?.completion_tokens_details?.reasoning_tokens);
      console.error('[OpenAI] empty_response', {
        model,
        provider,
        finishReason,
        reasoningTokens,
        promptTokens: usage.inputTokens,
        completionTokens: usage.outputTokens,
        totalTokens: usage.totalTokens,
        preview,
      });
      await recordLlmUsage({
        tracking: params.costTracking,
        provider,
        model,
        usage,
        success: false,
        errorCode: 'EMPTY_RESPONSE',
        latencyMs: Date.now() - startedAt,
        requestId,
        httpStatus: res.status,
        price: cost.price,
        priceMissing: cost.priceMissing,
        estimatedCostUsd: cost.estimatedCostUsd,
      });
      return {
        success: false,
        error: sanitizeProviderErrorMessage(`Resposta vazia da API. preview=${preview.slice(0, 280)}`),
        provider,
        model,
        errorCode: 'EMPTY_RESPONSE',
        classifiedError: 'UNKNOWN_LLM_ERROR',
        usage,
        estimatedCostUsd: cost.estimatedCostUsd,
      };
    }

    await recordLlmUsage({
      tracking: params.costTracking,
      provider,
      model,
      usage,
      success: true,
      errorCode: null,
      latencyMs: Date.now() - startedAt,
      requestId,
      httpStatus: res.status,
      price: cost.price,
      priceMissing: cost.priceMissing,
      estimatedCostUsd: cost.estimatedCostUsd,
    });
    return {
      success: true,
      content,
      httpStatus: res.status,
      provider,
      model,
      usage,
      estimatedCostUsd: cost.estimatedCostUsd,
    };
  } catch (e) {
    clearTimeout(timeout);
    const msg = e instanceof Error ? e.message : String(e);
    const classified = classifyLlmProviderError({
      provider,
      httpStatus: null,
      message: msg,
    });
    console.error('[OpenAI] Request failed:', {
      message: classified.sanitizedMessage,
      provider,
      model,
      classifiedError: classified.classifiedError,
    });
    const usage = parseUsage(undefined);
    const cost = estimateLlmCostUsd({
      model,
      inputTokens: usage.inputTokens,
      cachedInputTokens: usage.cachedInputTokens,
      outputTokens: usage.outputTokens,
    });
    await recordLlmUsage({
      tracking: params.costTracking,
      provider,
      model,
      usage,
      success: false,
      errorCode: classified.providerErrorCode ?? classified.classifiedError,
      latencyMs: Date.now() - startedAt,
      requestId: null,
      httpStatus: null,
      price: cost.price,
      priceMissing: cost.priceMissing,
      estimatedCostUsd: cost.estimatedCostUsd,
    });
    return {
      success: false,
      error: classified.sanitizedMessage,
      provider,
      model,
      errorCode: classified.providerErrorCode,
      errorType: classified.providerErrorType,
      classifiedError: classified.classifiedError,
      usage,
      estimatedCostUsd: cost.estimatedCostUsd,
    };
  }
}

