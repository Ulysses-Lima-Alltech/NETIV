import { createAnaDiagnostic } from '../repositories/anaDiagnosticsRepository.js';
import { getIntegrationModelStringsRaw, getOpenAIConfig } from '../repositories/openaiConfigRepository.js';
import { generateChatCompletion } from './openaiService.js';
import { resolveAnaOpenAIModel } from '../utils/resolveAnaOpenAIModel.js';
import {
  classifyLlmProviderError,
  detectLlmProvider,
  sanitizeProviderErrorMessage,
} from '../utils/llmProviderDiagnostics.js';

export interface AnaOpenAIDiagnosticResult {
  ok: boolean;
  provider: string;
  model: string | null;
  status: number | null;
  classifiedError: string | null;
  sanitizedMessage: string | null;
  canGenerate: boolean;
  recommendation: string;
}

export async function runAnaOpenAIDiagnostic(): Promise<AnaOpenAIDiagnosticResult> {
  const cfg = await getOpenAIConfig();
  const rawModels = await getIntegrationModelStringsRaw();
  const model = resolveAnaOpenAIModel({
    modelHotLeadFromDb: rawModels.modelHotLead,
    modelColdLeadFromDb: rawModels.modelColdLead,
  }).finalModel;
  const provider = detectLlmProvider(cfg?.openaiBaseUrl ?? null);

  if (!cfg) {
    const sanitizedMessage = 'Configuração de IA da Ana não foi encontrada.';
    await createAnaDiagnostic({
      diagnosticType: 'openai_healthcheck',
      provider,
      model,
      ok: false,
      status: null,
      classifiedError: 'UNKNOWN_RUNTIME_ERROR',
      sanitizedMessage,
      payloadJson: { provider, model, canGenerate: false, recommendation: 'Verifique a configuração da integração de IA.' },
    });
    return {
      ok: false,
      provider,
      model,
      status: null,
      classifiedError: 'UNKNOWN_RUNTIME_ERROR',
      sanitizedMessage,
      canGenerate: false,
      recommendation: 'Verifique a configuração da integração de IA.',
    };
  }

  if (!cfg.openaiApiKey?.trim()) {
    const sanitizedMessage = 'API key da OpenAI não está configurada.';
    await createAnaDiagnostic({
      diagnosticType: 'openai_healthcheck',
      provider,
      model,
      ok: false,
      status: null,
      classifiedError: 'OPENAI_AUTH_ERROR',
      sanitizedMessage,
      payloadJson: { provider, model, canGenerate: false, recommendation: 'Cadastre uma API key válida para a Ana.' },
    });
    return {
      ok: false,
      provider,
      model,
      status: null,
      classifiedError: 'OPENAI_AUTH_ERROR',
      sanitizedMessage,
      canGenerate: false,
      recommendation: 'Cadastre uma API key válida para a Ana.',
    };
  }

  const result = await generateChatCompletion({
    apiKey: cfg.openaiApiKey,
    baseUrl: cfg.openaiBaseUrl,
    model,
    messages: [{ role: 'user', content: 'Responda apenas com OK.' }],
    temperature: 0,
    maxTokens: 8,
    responseFormatJson: false,
  });

  if (result.success) {
    const sanitizedMessage = sanitizeProviderErrorMessage(result.content ?? 'OK');
    const payload = {
      provider: result.provider ?? provider,
      model,
      status: result.httpStatus ?? 200,
      classifiedError: null,
      sanitizedMessage,
      canGenerate: true,
      recommendation: 'Provider apto para gerar respostas da Ana.',
      responsePreview: sanitizedMessage.slice(0, 40),
    };
    await createAnaDiagnostic({
      diagnosticType: 'openai_healthcheck',
      provider: result.provider ?? provider,
      model,
      ok: true,
      status: result.httpStatus ?? 200,
      classifiedError: null,
      sanitizedMessage,
      payloadJson: payload,
    });
    return {
      ok: true,
      provider: result.provider ?? provider,
      model,
      status: result.httpStatus ?? 200,
      classifiedError: null,
      sanitizedMessage,
      canGenerate: true,
      recommendation: 'Provider apto para gerar respostas da Ana.',
    };
  }

  const classified = classifyLlmProviderError({
    provider: result.provider ?? provider,
    httpStatus: result.httpStatus ?? null,
    providerErrorCode: result.errorCode ?? null,
    providerErrorType: result.errorType ?? null,
    message: result.error ?? null,
  });

  await createAnaDiagnostic({
    diagnosticType: 'openai_healthcheck',
    provider: classified.provider,
    model,
    ok: false,
    status: classified.httpStatus,
    classifiedError: classified.classifiedError,
    sanitizedMessage: classified.sanitizedMessage,
    payloadJson: {
      provider: classified.provider,
      model,
      status: classified.httpStatus,
      classifiedError: classified.classifiedError,
      sanitizedMessage: classified.sanitizedMessage,
      canGenerate: false,
      recommendation: classified.recommendation,
      providerErrorCode: classified.providerErrorCode,
      providerErrorType: classified.providerErrorType,
    },
  });

  return {
    ok: false,
    provider: classified.provider,
    model,
    status: classified.httpStatus,
    classifiedError: classified.classifiedError,
    sanitizedMessage: classified.sanitizedMessage,
    canGenerate: false,
    recommendation: classified.recommendation,
  };
}
