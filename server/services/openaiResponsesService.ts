import { config } from '../config.js';
import { getOpenAIConfig } from '../repositories/openaiConfigRepository.js';

const REQUEST_TIMEOUT_MS = 60000;
const RESPONSES_PATH = '/responses';

export interface OpenAICredentials {
  apiKey: string;
  baseUrl: string;
  model: string;
}

/** Resolve credenciais: env tem prioridade; fallback para config do banco (key/url → OPENAI_API_KEY, OPENAI_BASE_URL). */
export function getOpenAICredentials(): OpenAICredentials | null {
  const fromEnv = config.openai.apiKey?.trim();
  if (fromEnv) {
    return {
      apiKey: config.openai.apiKey,
      baseUrl: config.openai.baseUrl,
      model: config.openai.model,
    };
  }
  const fromDb = getOpenAIConfig();
  if (fromDb?.openaiApiKey?.trim()) {
    const baseUrl = (fromDb.openaiBaseUrl?.trim() || 'https://api.openai.com/v1').replace(/\/$/, '');
    return {
      apiKey: fromDb.openaiApiKey,
      baseUrl,
      model: config.openai.model,
    };
  }
  return null;
}

/** Erro padronizado para o serviço de Responses. */
export class OpenAIResponsesError extends Error {
  constructor(
    message: string,
    public readonly code: 'NO_API_KEY' | 'API_ERROR' | 'EMPTY_RESPONSE' | 'REQUEST_FAILED'
  ) {
    super(message);
    this.name = 'OpenAIResponsesError';
  }
}

type InputMessage = { type: 'message'; role: 'system' | 'user'; content: string };

function buildInput(message: string, systemPrompt?: string): string | InputMessage[] {
  if (!systemPrompt?.trim()) return message;
  return [
    { type: 'message' as const, role: 'system' as const, content: systemPrompt.trim() },
    { type: 'message' as const, role: 'user' as const, content: message },
  ];
}

function extractTextFromOutput(output: unknown): string {
  if (!Array.isArray(output)) return '';
  const parts: string[] = [];
  for (const item of output) {
    const msg = item as { type?: string; content?: Array<{ type?: string; text?: string }> };
    const content = Array.isArray(msg.content) ? msg.content : [];
    for (const block of content) {
      if ((block as { type?: string }).type === 'output_text' && typeof (block as { text?: string }).text === 'string') {
        parts.push((block as { text: string }).text);
      }
    }
  }
  return parts.join('\n').trim();
}

/**
 * Gera texto via OpenAI Responses API (/v1/responses).
 * Usa credenciais de env (OPENAI_*) ou do banco; model opcional com fallback para OPENAI_MODEL.
 */
export async function generateText(
  message: string,
  options?: { systemPrompt?: string; model?: string }
): Promise<string> {
  const creds = getOpenAICredentials();
  if (!creds) {
    throw new OpenAIResponsesError(
      'OPENAI_API_KEY não configurada. Defina a variável de ambiente ou configure em Configurações > IA.',
      'NO_API_KEY'
    );
  }

  const model = options?.model?.trim() || creds.model;
  const input = buildInput(message, options?.systemPrompt);
  const url = `${creds.baseUrl}${RESPONSES_PATH}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creds.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model, input }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    const data = (await res.json()) as {
      output?: unknown[];
      error?: { message?: string; code?: string };
    };

    if (!res.ok) {
      const msg = data.error?.message ?? `Erro HTTP ${res.status}`;
      console.error('[OpenAI Responses] API error:', msg);
      throw new OpenAIResponsesError(msg, 'API_ERROR');
    }

    const text = extractTextFromOutput(data.output);
    if (!text) {
      throw new OpenAIResponsesError('Resposta vazia da API.', 'EMPTY_RESPONSE');
    }
    return text;
  } catch (e) {
    clearTimeout(timeout);
    if (e instanceof OpenAIResponsesError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[OpenAI Responses] Request failed:', msg);
    throw new OpenAIResponsesError(msg, 'REQUEST_FAILED');
  }
}
