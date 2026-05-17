import { query } from '../db/pg.js';
import type { AnaDecisionResponseMode } from '../utils/anaDecisionPolicy.js';
import type {
  EnterpriseResolutionCandidate,
  EnterpriseResolutionSource,
} from './enterpriseMatch.js';

export type AnaTurnAuditOutboundStatus =
  | 'sent'
  | 'blocked'
  | 'silent'
  | 'material_sent'
  | 'material_failed'
  | 'send_failed';

export interface AnaTurnAuditRow {
  id: number;
  conversation_id: number;
  message_id: number | null;
  enterprise_id: number | null;
  contact_id: number | null;
  user_message: string;
  resolved_intent: string | null;
  resolved_product_type: string | null;
  primary_axis: string | null;
  response_mode: AnaDecisionResponseMode | null;
  evidence_json: unknown;
  decision_json: unknown;
  guards_applied_json: unknown;
  diagnostics_json: unknown;
  outbound_status: AnaTurnAuditOutboundStatus;
  blocked_reason: string | null;
  missing_information_flag_created: boolean;
  missing_information_subject: string | null;
  enterprise_resolution_source: EnterpriseResolutionSource | null;
  resolved_enterprise_id: number | null;
  resolved_enterprise_name: string | null;
  enterprise_candidates: unknown;
  rag_was_loaded: boolean;
  reason_when_no_enterprise: string | null;
  provider: string | null;
  model: string | null;
  api_key_source: 'enterprise' | 'global_fallback' | null;
  openai_api_key_id: string | null;
  openai_project_id: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cached_input_tokens: number | null;
  request_type: string | null;
  llm_status: 'success' | 'blocked' | 'skipped' | 'error' | null;
  llm_http_status: number | null;
  error_code: string | null;
  error_message: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface CreateAnaTurnAuditInput {
  conversationId: number;
  messageId?: number | null;
  enterpriseId?: number | null;
  contactId?: number | null;
  userMessage: string;
  resolvedIntent?: string | null;
  resolvedProductType?: string | null;
  primaryAxis?: string | null;
  responseMode?: AnaDecisionResponseMode | null;
  evidenceJson?: unknown;
  decisionJson?: unknown;
  guardsAppliedJson?: unknown;
  diagnosticsJson?: unknown;
  outboundStatus?: AnaTurnAuditOutboundStatus;
  blockedReason?: string | null;
  missingInformationFlagCreated?: boolean;
  missingInformationSubject?: string | null;
  enterpriseResolutionSource?: EnterpriseResolutionSource | null;
  resolvedEnterpriseId?: number | null;
  resolvedEnterpriseName?: string | null;
  enterpriseCandidates?: EnterpriseResolutionCandidate[];
  ragWasLoaded?: boolean;
  reasonWhenNoEnterprise?: string | null;
  provider?: string | null;
  model?: string | null;
  apiKeySource?: 'enterprise' | 'global_fallback' | null;
  openaiApiKeyId?: string | null;
  openaiProjectId?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cachedInputTokens?: number | null;
  requestType?: string | null;
  llmStatus?: 'success' | 'blocked' | 'skipped' | 'error' | null;
  llmHttpStatus?: number | null;
  errorCode?: string | null;
  errorMessage?: string | null;
}

export interface UpdateAnaTurnAuditOutcomeInput {
  outboundStatus?: AnaTurnAuditOutboundStatus;
  blockedReason?: string | null;
  guardsAppliedJson?: unknown;
  decisionJson?: unknown;
  diagnosticsJson?: unknown;
  missingInformationFlagCreated?: boolean;
  missingInformationSubject?: string | null;
  enterpriseResolutionSource?: EnterpriseResolutionSource | null;
  resolvedEnterpriseId?: number | null;
  resolvedEnterpriseName?: string | null;
  enterpriseCandidates?: EnterpriseResolutionCandidate[];
  ragWasLoaded?: boolean;
  reasonWhenNoEnterprise?: string | null;
  provider?: string | null;
  model?: string | null;
  apiKeySource?: 'enterprise' | 'global_fallback' | null;
  openaiApiKeyId?: string | null;
  openaiProjectId?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cachedInputTokens?: number | null;
  requestType?: string | null;
  llmStatus?: 'success' | 'blocked' | 'skipped' | 'error' | null;
  llmHttpStatus?: number | null;
  errorCode?: string | null;
  errorMessage?: string | null;
}

function toJsonString(payload: unknown): string {
  return JSON.stringify(payload ?? {});
}

export async function createAnaTurnAudit(
  input: CreateAnaTurnAuditInput
): Promise<AnaTurnAuditRow> {
  const { rows } = await query<AnaTurnAuditRow>(
    `INSERT INTO ana_turn_audit (
       conversation_id,
       message_id,
       enterprise_id,
       contact_id,
       user_message,
       resolved_intent,
       resolved_product_type,
       primary_axis,
       response_mode,
       evidence_json,
       decision_json,
       guards_applied_json,
       diagnostics_json,
       outbound_status,
       blocked_reason,
       missing_information_flag_created,
       missing_information_subject,
       enterprise_resolution_source,
       resolved_enterprise_id,
       resolved_enterprise_name,
       enterprise_candidates,
       rag_was_loaded,
       reason_when_no_enterprise,
       provider,
       model,
       api_key_source,
       openai_api_key_id,
       openai_project_id,
       input_tokens,
       output_tokens,
       cached_input_tokens,
       request_type,
       llm_status,
       llm_http_status,
       error_code,
       error_message
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9,
       $10::jsonb, $11::jsonb, $12::jsonb, $13::jsonb, $14, $15, $16, $17,
       $18, $19, $20, $21::jsonb, $22, $23,
       $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36
     )
     RETURNING *`,
    [
      input.conversationId,
      input.messageId ?? null,
      input.enterpriseId ?? null,
      input.contactId ?? null,
      input.userMessage,
      input.resolvedIntent ?? null,
      input.resolvedProductType ?? null,
      input.primaryAxis ?? null,
      input.responseMode ?? null,
      toJsonString(input.evidenceJson),
      toJsonString(input.decisionJson),
      toJsonString(input.guardsAppliedJson),
      toJsonString(input.diagnosticsJson),
      input.outboundStatus ?? 'silent',
      input.blockedReason ?? null,
      input.missingInformationFlagCreated === true,
      input.missingInformationSubject ?? null,
      input.enterpriseResolutionSource ?? null,
      input.resolvedEnterpriseId ?? input.enterpriseId ?? null,
      input.resolvedEnterpriseName ?? null,
      toJsonString(input.enterpriseCandidates ?? []),
      input.ragWasLoaded === true,
      input.reasonWhenNoEnterprise ?? null,
      input.provider ?? null,
      input.model ?? null,
      input.apiKeySource ?? null,
      input.openaiApiKeyId ?? null,
      input.openaiProjectId ?? null,
      input.inputTokens ?? null,
      input.outputTokens ?? null,
      input.cachedInputTokens ?? null,
      input.requestType ?? null,
      input.llmStatus ?? null,
      input.llmHttpStatus ?? null,
      input.errorCode ?? null,
      input.errorMessage ?? null,
    ]
  );
  return rows[0];
}

export async function getLastAnaTurnAuditByConversation(
  conversationId: number
): Promise<AnaTurnAuditRow | null> {
  const { rows } = await query<AnaTurnAuditRow>(
    `SELECT *
     FROM ana_turn_audit
     WHERE conversation_id = $1
     ORDER BY created_at DESC, id DESC
     LIMIT 1`,
    [conversationId]
  );
  return rows[0] ?? null;
}

export async function updateAnaTurnAuditOutcome(
  id: number,
  input: UpdateAnaTurnAuditOutcomeInput
): Promise<AnaTurnAuditRow | null> {
  const sets: string[] = ['updated_at = NOW()'];
  const values: unknown[] = [id];
  let i = 2;

  if (input.outboundStatus !== undefined) {
    sets.push(`outbound_status = $${i++}`);
    values.push(input.outboundStatus);
  }
  if (input.blockedReason !== undefined) {
    sets.push(`blocked_reason = $${i++}`);
    values.push(input.blockedReason);
  }
  if (input.guardsAppliedJson !== undefined) {
    sets.push(`guards_applied_json = $${i++}::jsonb`);
    values.push(toJsonString(input.guardsAppliedJson));
  }
  if (input.decisionJson !== undefined) {
    sets.push(`decision_json = $${i++}::jsonb`);
    values.push(toJsonString(input.decisionJson));
  }
  if (input.diagnosticsJson !== undefined) {
    sets.push(`diagnostics_json = $${i++}::jsonb`);
    values.push(toJsonString(input.diagnosticsJson));
  }
  if (input.missingInformationFlagCreated !== undefined) {
    sets.push(`missing_information_flag_created = $${i++}`);
    values.push(input.missingInformationFlagCreated === true);
  }
  if (input.missingInformationSubject !== undefined) {
    sets.push(`missing_information_subject = $${i++}`);
    values.push(input.missingInformationSubject);
  }
  if (input.enterpriseResolutionSource !== undefined) {
    sets.push(`enterprise_resolution_source = $${i++}`);
    values.push(input.enterpriseResolutionSource);
  }
  if (input.resolvedEnterpriseId !== undefined) {
    sets.push(`resolved_enterprise_id = $${i++}`);
    values.push(input.resolvedEnterpriseId);
  }
  if (input.resolvedEnterpriseName !== undefined) {
    sets.push(`resolved_enterprise_name = $${i++}`);
    values.push(input.resolvedEnterpriseName);
  }
  if (input.enterpriseCandidates !== undefined) {
    sets.push(`enterprise_candidates = $${i++}::jsonb`);
    values.push(toJsonString(input.enterpriseCandidates));
  }
  if (input.ragWasLoaded !== undefined) {
    sets.push(`rag_was_loaded = $${i++}`);
    values.push(input.ragWasLoaded === true);
  }
  if (input.reasonWhenNoEnterprise !== undefined) {
    sets.push(`reason_when_no_enterprise = $${i++}`);
    values.push(input.reasonWhenNoEnterprise);
  }
  if (input.provider !== undefined) {
    sets.push(`provider = $${i++}`);
    values.push(input.provider);
  }
  if (input.model !== undefined) {
    sets.push(`model = $${i++}`);
    values.push(input.model);
  }
  if (input.apiKeySource !== undefined) {
    sets.push(`api_key_source = $${i++}`);
    values.push(input.apiKeySource);
  }
  if (input.openaiApiKeyId !== undefined) {
    sets.push(`openai_api_key_id = $${i++}`);
    values.push(input.openaiApiKeyId);
  }
  if (input.openaiProjectId !== undefined) {
    sets.push(`openai_project_id = $${i++}`);
    values.push(input.openaiProjectId);
  }
  if (input.inputTokens !== undefined) {
    sets.push(`input_tokens = $${i++}`);
    values.push(input.inputTokens);
  }
  if (input.outputTokens !== undefined) {
    sets.push(`output_tokens = $${i++}`);
    values.push(input.outputTokens);
  }
  if (input.cachedInputTokens !== undefined) {
    sets.push(`cached_input_tokens = $${i++}`);
    values.push(input.cachedInputTokens);
  }
  if (input.requestType !== undefined) {
    sets.push(`request_type = $${i++}`);
    values.push(input.requestType);
  }
  if (input.llmStatus !== undefined) {
    sets.push(`llm_status = $${i++}`);
    values.push(input.llmStatus);
  }
  if (input.llmHttpStatus !== undefined) {
    sets.push(`llm_http_status = $${i++}`);
    values.push(input.llmHttpStatus);
  }
  if (input.errorCode !== undefined) {
    sets.push(`error_code = $${i++}`);
    values.push(input.errorCode);
  }
  if (input.errorMessage !== undefined) {
    sets.push(`error_message = $${i++}`);
    values.push(input.errorMessage);
  }

  const { rows } = await query<AnaTurnAuditRow>(
    `UPDATE ana_turn_audit
     SET ${sets.join(', ')}
     WHERE id = $1
     RETURNING *`,
    values
  );
  return rows[0] ?? null;
}
