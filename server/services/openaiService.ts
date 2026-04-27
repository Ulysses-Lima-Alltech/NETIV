import {
  classifyLlmProviderError,
  detectLlmProvider,
  sanitizeProviderErrorMessage,
  type LlmClassifiedError,
  type LlmProvider,
} from '../utils/llmProviderDiagnostics.js';

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
  /** Força saída JSON (modelos com suporte a `response_format`). */
  responseFormatJson?: boolean;
}

export interface GenerateCompletionResult {
  success: boolean;
  content?: string;
  error?: string;
  /** Status HTTP quando a API retornou corpo de erro (diagnóstico). */
  httpStatus?: number;
  provider?: LlmProvider;
  model?: string;
  errorCode?: string | null;
  errorType?: string | null;
  classifiedError?: LlmClassifiedError | null;
}

export async function generateChatCompletion(params: GenerateCompletionParams): Promise<GenerateCompletionResult> {
  const { apiKey, baseUrl, model, messages, temperature, maxTokens, responseFormatJson } = params;
  const url = (baseUrl?.trim() || 'https://api.openai.com/v1').replace(/\/$/, '') + '/chat/completions';
  const provider = detectLlmProvider(baseUrl);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  /** Modelos que usam `max_completion_tokens` em vez de `max_tokens` + `temperature`. */
  const usesMaxCompletionTokensOnly = /^gpt-5/i.test(model) || /^o3/i.test(model);
  const body: Record<string, unknown> = {
    model,
    messages,
  };
  if (responseFormatJson) {
    body.response_format = { type: 'json_object' };
  }
  if (usesMaxCompletionTokensOnly) {
    body.max_completion_tokens = maxTokens;
  } else {
    body.temperature = temperature;
    body.max_tokens = maxTokens;
  }

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
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string; code?: string; type?: string; param?: string };
    };

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
      return {
        success: false,
        error: classified.sanitizedMessage,
        httpStatus: res.status,
        provider,
        model,
        errorCode: classified.providerErrorCode,
        errorType: classified.providerErrorType,
        classifiedError: classified.classifiedError,
      };
    }

    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) {
      const preview = JSON.stringify(data).slice(0, 600);
      console.error('[OpenAI] resposta sem content (choices vazio ou null)', { model, preview });
      return {
        success: false,
        error: sanitizeProviderErrorMessage(`Resposta vazia da API. preview=${preview.slice(0, 280)}`),
        provider,
        model,
        classifiedError: 'UNKNOWN_LLM_ERROR',
      };
    }
    return { success: true, content, httpStatus: res.status, provider, model };
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
    return {
      success: false,
      error: classified.sanitizedMessage,
      provider,
      model,
      errorCode: classified.providerErrorCode,
      errorType: classified.providerErrorType,
      classifiedError: classified.classifiedError,
    };
  }
}
