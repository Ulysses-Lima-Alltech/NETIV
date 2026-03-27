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
}

export async function generateChatCompletion(params: GenerateCompletionParams): Promise<GenerateCompletionResult> {
  const { apiKey, baseUrl, model, messages, temperature, maxTokens, responseFormatJson } = params;
  const url = (baseUrl?.trim() || 'https://api.openai.com/v1').replace(/\/$/, '') + '/chat/completions';

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
      error?: { message?: string };
    };

    if (!res.ok) {
      const msg = data.error?.message ?? `Erro HTTP ${res.status}`;
      console.error('[OpenAI] API error:', msg);
      return { success: false, error: msg };
    }

    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) {
      return { success: false, error: 'Resposta vazia da API.' };
    }
    return { success: true, content };
  } catch (e) {
    clearTimeout(timeout);
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[OpenAI] Request failed:', msg);
    return { success: false, error: msg };
  }
}
