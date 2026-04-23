import { query } from '../db/pg.js';
import type { AnaDecisionResponseMode } from '../utils/anaDecisionPolicy.js';

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
  user_message: string;
  resolved_intent: string | null;
  resolved_product_type: string | null;
  primary_axis: string | null;
  response_mode: AnaDecisionResponseMode | null;
  evidence_json: unknown;
  decision_json: unknown;
  guards_applied_json: unknown;
  outbound_status: AnaTurnAuditOutboundStatus;
  blocked_reason: string | null;
  missing_information_flag_created: boolean;
  missing_information_subject: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface CreateAnaTurnAuditInput {
  conversationId: number;
  messageId?: number | null;
  enterpriseId?: number | null;
  userMessage: string;
  resolvedIntent?: string | null;
  resolvedProductType?: string | null;
  primaryAxis?: string | null;
  responseMode?: AnaDecisionResponseMode | null;
  evidenceJson?: unknown;
  decisionJson?: unknown;
  guardsAppliedJson?: unknown;
  outboundStatus?: AnaTurnAuditOutboundStatus;
  blockedReason?: string | null;
  missingInformationFlagCreated?: boolean;
  missingInformationSubject?: string | null;
}

export interface UpdateAnaTurnAuditOutcomeInput {
  outboundStatus?: AnaTurnAuditOutboundStatus;
  blockedReason?: string | null;
  guardsAppliedJson?: unknown;
  decisionJson?: unknown;
  missingInformationFlagCreated?: boolean;
  missingInformationSubject?: string | null;
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
       user_message,
       resolved_intent,
       resolved_product_type,
       primary_axis,
       response_mode,
       evidence_json,
       decision_json,
       guards_applied_json,
       outbound_status,
       blocked_reason,
       missing_information_flag_created,
       missing_information_subject
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8,
       $9::jsonb, $10::jsonb, $11::jsonb, $12, $13, $14, $15
     )
     RETURNING *`,
    [
      input.conversationId,
      input.messageId ?? null,
      input.enterpriseId ?? null,
      input.userMessage,
      input.resolvedIntent ?? null,
      input.resolvedProductType ?? null,
      input.primaryAxis ?? null,
      input.responseMode ?? null,
      toJsonString(input.evidenceJson),
      toJsonString(input.decisionJson),
      toJsonString(input.guardsAppliedJson),
      input.outboundStatus ?? 'silent',
      input.blockedReason ?? null,
      input.missingInformationFlagCreated === true,
      input.missingInformationSubject ?? null,
    ]
  );
  return rows[0];
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
  if (input.missingInformationFlagCreated !== undefined) {
    sets.push(`missing_information_flag_created = $${i++}`);
    values.push(input.missingInformationFlagCreated === true);
  }
  if (input.missingInformationSubject !== undefined) {
    sets.push(`missing_information_subject = $${i++}`);
    values.push(input.missingInformationSubject);
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
