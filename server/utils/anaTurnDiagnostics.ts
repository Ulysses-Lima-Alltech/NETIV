import type { LlmClassifiedError, LlmProvider } from './llmProviderDiagnostics.js';

export type AnaTurnStage =
  | 'inbound_received'
  | 'enterprise_resolution'
  | 'rag_retrieval'
  | 'prompt_build'
  | 'llm_generation'
  | 'provider_fallback'
  | 'final_response';

export type AnaTurnStageStatus = 'passed' | 'failed' | 'skipped';

export interface AnaTurnDiagnostics {
  schemaVersion: number;
  contactId: number | null;
  provider: LlmProvider;
  model: string | null;
  classifiedError: LlmClassifiedError | null;
  fallbackUsed: boolean;
  fallbackReason: string | null;
  stages: Partial<Record<AnaTurnStage, { status: AnaTurnStageStatus; at: string; meta?: Record<string, unknown> }>>;
  rag: {
    consulted: boolean;
    enterpriseResolved: boolean;
    enterpriseId: number | null;
    activeKnowledgeFileCount: number;
    evidenceChunkCount: number;
    sourceFiles: string[];
    includedInPrompt: boolean;
    reason: string | null;
  };
  llm: {
    provider: LlmProvider;
    model: string | null;
    httpStatus: number | null;
    providerErrorCode: string | null;
    providerErrorType: string | null;
    sanitizedMessage: string | null;
    canGenerate: boolean | null;
    providerFallbackAttempted: boolean;
  };
  finalResponse: {
    replySource: string | null;
    handoffUsed: boolean;
    outboundStatus: string | null;
  };
  updatedAt: string;
}

export function createAnaTurnDiagnostics(input: {
  contactId?: number | null;
  provider?: LlmProvider;
  model?: string | null;
}): AnaTurnDiagnostics {
  return {
    schemaVersion: 1,
    contactId: input.contactId ?? null,
    provider: input.provider ?? 'openai',
    model: input.model ?? null,
    classifiedError: null,
    fallbackUsed: false,
    fallbackReason: null,
    stages: {},
    rag: {
      consulted: false,
      enterpriseResolved: false,
      enterpriseId: null,
      activeKnowledgeFileCount: 0,
      evidenceChunkCount: 0,
      sourceFiles: [],
      includedInPrompt: false,
      reason: null,
    },
    llm: {
      provider: input.provider ?? 'openai',
      model: input.model ?? null,
      httpStatus: null,
      providerErrorCode: null,
      providerErrorType: null,
      sanitizedMessage: null,
      canGenerate: null,
      providerFallbackAttempted: false,
    },
    finalResponse: {
      replySource: null,
      handoffUsed: false,
      outboundStatus: null,
    },
    updatedAt: new Date().toISOString(),
  };
}

export function markAnaTurnStage(
  diagnostics: AnaTurnDiagnostics,
  stage: AnaTurnStage,
  status: AnaTurnStageStatus,
  meta?: Record<string, unknown>
): void {
  diagnostics.stages[stage] = {
    status,
    at: new Date().toISOString(),
    ...(meta ? { meta } : {}),
  };
  diagnostics.updatedAt = new Date().toISOString();
}
