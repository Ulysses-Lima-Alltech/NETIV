import { query } from '../db/pg.js';

export interface LlmUsageEventInput {
  provider: string;
  model: string;
  apiKeySource?: 'enterprise' | 'global_fallback' | null;
  openaiApiKeyId?: string | null;
  openaiProjectId?: string | null;
  requestType?: string | null;
  purpose: string;
  modelReason?: string | null;
  conversationId?: number | null;
  contactId?: number | null;
  enterpriseId?: number | null;
  inboundMessageId?: number | null;
  outboundMessageId?: number | null;
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  estimatedCostUsd?: number;
  success?: boolean;
  errorCode?: string | null;
  latencyMs?: number | null;
  requestId?: string | null;
  metadata?: unknown;
}

export async function insertLlmUsageEvent(input: LlmUsageEventInput): Promise<void> {
  await query(
    `INSERT INTO llm_usage_events (
       provider, model, api_key_source, openai_api_key_id, openai_project_id, request_type, purpose, model_reason,
       conversation_id, contact_id, enterprise_id, inbound_message_id, outbound_message_id,
       input_tokens, cached_input_tokens, output_tokens, total_tokens,
       estimated_cost_usd, success, error_code, latency_ms, request_id, metadata
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8,
       $9, $10, $11, $12, $13,
       $14, $15, $16, $17,
       $18, $19, $20, $21, $22, $23::jsonb
     )`,
    [
      input.provider,
      input.model,
      input.apiKeySource ?? null,
      input.openaiApiKeyId ?? null,
      input.openaiProjectId ?? null,
      input.requestType ?? null,
      input.purpose,
      input.modelReason ?? null,
      input.conversationId ?? null,
      input.contactId ?? null,
      input.enterpriseId ?? null,
      input.inboundMessageId ?? null,
      input.outboundMessageId ?? null,
      input.inputTokens ?? 0,
      input.cachedInputTokens ?? 0,
      input.outputTokens ?? 0,
      input.totalTokens ?? 0,
      input.estimatedCostUsd ?? 0,
      input.success !== false,
      input.errorCode ?? null,
      input.latencyMs ?? null,
      input.requestId ?? null,
      JSON.stringify(input.metadata ?? {}),
    ]
  );
}
