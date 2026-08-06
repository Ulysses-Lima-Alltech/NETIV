import { getPool, query } from '../db/pg.js';
import {
  getWhatsAppTemplateByKey,
  renderTemplateTextForInbox,
  type WhatsAppTemplateCatalogItem,
} from '../catalogs/whatsappTemplates.js';
import { detectBatchColumns, type BatchColumnSuggestions } from '../utils/columnDetection.js';
import { normalizePhoneE164 } from '../utils/phone.js';
import type {
  BatchConversationType,
  BatchMappingDto,
  BatchPostSendMode,
  BatchSendMode,
} from '../validators/whatsappBatch.js';
import { getEnterpriseById } from '../repositories/enterpriseRepository.js';
import {
  findOrCreateConversation,
  updateClassification,
  updateConversationType,
} from '../repositories/conversationRepository.js';
import { insertMessage } from '../repositories/messageRepository.js';
import { getWhatsAppConfig } from '../repositories/whatsappConfigRepository.js';
import { sendTemplateMessage } from './whatsappMetaService.js';
import { getCorretorById } from '../repositories/corretorRepository.js';
import { findOrCreateContactByPhone, updateContactType } from '../repositories/contactsRepository.js';
import { isAnaAutomationBlockedByHandoff } from '../utils/anaAutomationEligibility.js';

export interface BatchPreviewRow {
  rowIndex: number;
  rowNumber: number;
  phoneOriginal: string | null;
  phoneNormalized: string | null;
  isValid: boolean;
  status: 'valid' | 'invalid' | 'blocked';
  error: string | null;
  assignedBrokerId?: number | null;
  assignedBrokerName?: string | null;
  resolvedVariables: Array<{
    variableId: number;
    label: string;
    value: string | null;
    sourceType: 'column' | 'fixed' | 'enterprise';
    sourceLabel: string;
  }>;
}

export interface BatchExecutionResult {
  total: number;
  success: number;
  failed: number;
  details: Array<{
    rowNumber: number;
    phoneOriginal: string | null;
    phoneNormalized: string | null;
    status: 'sent' | 'blocked' | 'error';
    error: string | null;
    errorCode?: number;
    errorType?: string;
    httpStatus?: number;
    templateKey: string;
    metaMessageId?: string;
  }>;
}

export interface BatchPersistedConversationState {
  id: number;
  contact_id: number | null;
  handoff: boolean | null;
  classification: string | null;
}

export interface BatchScheduleResult {
  scheduled: true;
  batchId: number;
  status: 'PENDING';
  total: number;
  validRecipients: number;
  invalidRecipients: number;
  scheduledAt: string;
  conversationType: BatchConversationType;
  postSendMode: BatchPostSendMode;
  message: string;
}

export type BatchSendResult = BatchExecutionResult | BatchScheduleResult;

type NormalizedBatchSendMode = BatchSendMode;
type NormalizedBatchConversationType = BatchConversationType;
type NormalizedBatchPostSendMode = BatchPostSendMode;

export type BatchHandoffDeliveryDecision =
  | { allowed: true; effectivePostSendMode: NormalizedBatchPostSendMode }
  | { allowed: false; reason: 'handoff' | 'carteira' };

interface BatchSendPreferences {
  conversationType?: BatchConversationType;
  postSendMode?: BatchPostSendMode;
  sendMode?: BatchSendMode;
  scheduledAt?: string | null;
  createdByUserId?: number | null;
}

interface PreparedBatchCandidate {
  rowNumber: number;
  phoneOriginal: string | null;
  phoneNormalized: string;
  resolvedValues: string[];
  assignedBrokerId: number | null;
  assignedBrokerName: string | null;
}

interface PreparedBatchCandidatesResult {
  candidates: PreparedBatchCandidate[];
  blockedDetails: BatchExecutionResult['details'];
}

interface ScheduledBatchRow {
  id: number;
  enterprise_id: number | null;
  template_key: string;
  payload_json: unknown;
  conversation_type: NormalizedBatchConversationType;
  post_send_mode: NormalizedBatchPostSendMode;
  scheduled_at: Date;
  status: 'PENDING' | 'PROCESSING' | 'SENT' | 'PARTIAL_FAILED' | 'FAILED' | 'CANCELED';
}

interface ScheduledBatchRecipientRow {
  id: number;
  batch_id: number;
  row_number: number;
  phone: string;
  name: string | null;
  variables_json: unknown;
  assigned_broker_id: number | null;
  status: 'PENDING' | 'PROCESSING' | 'SENT' | 'FAILED' | 'CANCELED';
}

function normalizeBatchClassification(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase();
}

export function resolveBatchHandoffDeliveryDecision(params: {
  sourceKeyPrefix: string;
  requestedPostSendMode: NormalizedBatchPostSendMode;
  conversation: BatchPersistedConversationState | null;
}): BatchHandoffDeliveryDecision {
  const isScheduledAutomation = params.sourceKeyPrefix.startsWith('scheduled_batch:');
  const inHandoff = isAnaAutomationBlockedByHandoff(params.conversation);
  const inCarteira = normalizeBatchClassification(params.conversation?.classification) === 'carteira';

  if (isScheduledAutomation) {
    if (inHandoff) return { allowed: false, reason: 'handoff' };
    if (inCarteira) return { allowed: false, reason: 'carteira' };
  }

  return {
    allowed: true,
    effectivePostSendMode: inHandoff ? 'HANDOFF' : params.requestedPostSendMode,
  };
}

function normalizePhoneStrict(phoneRaw: string | null | undefined): { phoneNormalized: string | null; error: string | null } {
  const normalized = normalizePhoneE164(phoneRaw ?? '');
  if (!normalized) return { phoneNormalized: null, error: 'Telefone ausente ou inválido.' };
  if (normalized.length !== 12 && normalized.length !== 13) {
    return { phoneNormalized: null, error: 'Telefone deve ter 12 ou 13 dígitos após normalização.' };
  }
  return { phoneNormalized: normalized, error: null };
}

function normalizeValue(value: string | null | undefined): string | null {
  const v = String(value ?? '').trim();
  return v.length > 0 ? v : null;
}

function getTemplateOrThrow(templateKey: string): WhatsAppTemplateCatalogItem {
  const template = getWhatsAppTemplateByKey(templateKey);
  if (!template) throw new Error('Template não encontrado no catálogo disponível.');
  return template;
}

function assertTemplateHeaderMediaConfigured(template: WhatsAppTemplateCatalogItem): void {
  if (!template.requiresHeaderMedia) return;
  if (template.hasConfiguredHeaderMedia || template.headerMediaId || template.headerImageUrl?.trim()) return;
  throw new Error('Este template exige imagem de cabeçalho. Anexe uma imagem antes de enviar.');
}

function assertTemplateApproved(template: WhatsAppTemplateCatalogItem): void {
  if (template.source === 'local_fallback') return;
  const status = String(template.status ?? 'APPROVED').toUpperCase();
  if (status === 'APPROVED') return;
  throw new Error('Apenas templates aprovados podem ser usados no disparo em lote.');
}

async function resolveEnterprise(selectedEnterpriseId: number | null | undefined): Promise<{ id: number; name: string } | null> {
  if (selectedEnterpriseId == null) return null;
  const ent = await getEnterpriseById(selectedEnterpriseId);
  if (!ent || ent.status !== 'ativo') throw new Error('Empreendimento selecionado é inválido ou inativo.');
  return { id: ent.id, name: ent.name };
}

async function resolveBroker(selectedBrokerId: number | null | undefined): Promise<{ id: number; fullName: string } | null> {
  if (selectedBrokerId == null) return null;
  const broker = await getCorretorById(selectedBrokerId);
  if (!broker || !broker.active) throw new Error('Corretor selecionado é inválido ou inativo.');
  return { id: broker.id, fullName: broker.full_name };
}

async function resolveSelectedBrokers(mapping: BatchMappingDto): Promise<Array<{ id: number; fullName: string }>> {
  const explicitIds = Array.isArray(mapping.selectedBrokerIds) ? mapping.selectedBrokerIds : [];
  const uniqueIds = [...new Set(explicitIds.filter((id) => Number.isInteger(id) && id > 0))];
  if (uniqueIds.length > 0) {
    const brokers: Array<{ id: number; fullName: string }> = [];
    for (const brokerId of uniqueIds) {
      const broker = await getCorretorById(brokerId);
      if (!broker || !broker.active) throw new Error('Um dos corretores selecionados é inválido ou inativo.');
      brokers.push({ id: broker.id, fullName: broker.full_name });
    }
    return brokers.sort((a, b) => {
      const byName = a.fullName.localeCompare(b.fullName, 'pt-BR', { sensitivity: 'base' });
      if (byName !== 0) return byName;
      return a.id - b.id;
    });
  }

  const single = await resolveBroker(mapping.selectedBrokerId ?? null);
  return single ? [single] : [];
}

function normalizeConversationType(
  conversationType: BatchConversationType | undefined
): NormalizedBatchConversationType {
  return conversationType === 'ADMIN' ? 'ADMIN' : 'CLIENT';
}

function normalizePostSendMode(postSendMode: BatchPostSendMode | undefined): NormalizedBatchPostSendMode {
  return postSendMode === 'HANDOFF' ? 'HANDOFF' : 'ANA';
}

function normalizeSendMode(sendMode: BatchSendMode | undefined): NormalizedBatchSendMode {
  return sendMode === 'SCHEDULED' ? 'SCHEDULED' : 'NOW';
}

function parseScheduledAtOrThrow(scheduledAtRaw: string | null | undefined): Date {
  const value = String(scheduledAtRaw ?? '').trim();
  if (!value) throw new Error('Data/hora de agendamento é obrigatória.');
  const scheduledAt = new Date(value);
  if (Number.isNaN(scheduledAt.getTime())) throw new Error('Data/hora de agendamento inválida.');
  if (scheduledAt.getTime() <= Date.now()) throw new Error('A data/hora do agendamento deve ser futura.');
  return scheduledAt;
}

function resolveVariablesForRow(params: {
  row: Record<string, string>;
  template: WhatsAppTemplateCatalogItem;
  mapping: BatchMappingDto;
  enterprise: { id: number; name: string } | null;
}): {
  values: string[];
  details: BatchPreviewRow['resolvedVariables'];
  missingRequired: boolean;
} {
  const details: BatchPreviewRow['resolvedVariables'] = [];
  const values: string[] = [];
  let missingRequired = false;

  for (const variable of params.template.variables) {
    const mappingItem = params.mapping.variableMappings[String(variable.id)];
    if (!mappingItem) {
      missingRequired = true;
      details.push({
        variableId: variable.id,
        label: variable.label,
        value: null,
        sourceType: 'fixed',
        sourceLabel: 'não definido',
      });
      continue;
    }

    if (mappingItem.type === 'column') {
      const columnName = mappingItem.columnName ?? '';
      const value = normalizeValue(columnName ? params.row[columnName] : undefined);
      if (!value && variable.required) missingRequired = true;
      details.push({
        variableId: variable.id,
        label: variable.label,
        value,
        sourceType: 'column',
        sourceLabel: `coluna: ${columnName || '(nome da coluna ausente)'}`,
      });
      values.push(value ?? '');
      continue;
    }

    if (mappingItem.type === 'fixed') {
      const value = normalizeValue(mappingItem.fixedValue);
      if (!value && variable.required) missingRequired = true;
      details.push({
        variableId: variable.id,
        label: variable.label,
        value,
        sourceType: 'fixed',
        sourceLabel: 'valor fixo',
      });
      values.push(value ?? '');
      continue;
    }

    const value = normalizeValue(params.enterprise?.name ?? null);
    if (!value && variable.required) missingRequired = true;
    details.push({
      variableId: variable.id,
      label: variable.label,
      value,
      sourceType: 'enterprise',
      sourceLabel: 'cadastro de empreendimento',
    });
    values.push(value ?? '');
  }

  return { values, details, missingRequired };
}

export function buildBatchSuggestions(headers: string[]): BatchColumnSuggestions {
  return detectBatchColumns(headers);
}

export async function buildBatchPreview(params: {
  rows: Record<string, string>[];
  mapping: BatchMappingDto;
}): Promise<{
  total: number;
  validCount: number;
  invalidCount: number;
  blockedCount: number;
  rows: BatchPreviewRow[];
}> {
  const template = getTemplateOrThrow(params.mapping.templateKey);
  assertTemplateApproved(template);
  assertTemplateHeaderMediaConfigured(template);
  const selectedBrokers = await resolveSelectedBrokers(params.mapping);
  const enterprise = await resolveEnterprise(params.mapping.selectedEnterpriseId);
  const previewRows: BatchPreviewRow[] = [];
  let validCount = 0;
  let invalidCount = 0;
  let blockedCount = 0;
  let roundRobinIndex = 0;

  for (let i = 0; i < params.rows.length; i++) {
    const row = params.rows[i];
    const phoneOriginal = normalizeValue(row[params.mapping.phoneColumn]);
    const phone = normalizePhoneStrict(phoneOriginal);
    const resolved = resolveVariablesForRow({
      row,
      template,
      mapping: params.mapping,
      enterprise,
    });

    if (phone.error) {
      invalidCount++;
      previewRows.push({
        rowIndex: i,
        rowNumber: i + 2,
        phoneOriginal,
        phoneNormalized: null,
        isValid: false,
        status: 'invalid',
        error: phone.error,
        resolvedVariables: resolved.details,
      });
      continue;
    }

    if (resolved.missingRequired) {
      blockedCount++;
      previewRows.push({
        rowIndex: i,
        rowNumber: i + 2,
        phoneOriginal,
        phoneNormalized: phone.phoneNormalized,
        isValid: false,
        status: 'blocked',
        error: 'Variáveis obrigatórias não resolvidas para esta linha.',
        resolvedVariables: resolved.details,
      });
      continue;
    }

    validCount++;
    const assignedBroker =
      selectedBrokers.length > 0
        ? selectedBrokers[roundRobinIndex % selectedBrokers.length] ?? null
        : null;
    if (selectedBrokers.length > 0) roundRobinIndex++;
    previewRows.push({
      rowIndex: i,
      rowNumber: i + 2,
      phoneOriginal,
      phoneNormalized: phone.phoneNormalized,
      isValid: true,
      status: 'valid',
      error: null,
      assignedBrokerId: assignedBroker?.id ?? null,
      assignedBrokerName: assignedBroker?.fullName ?? null,
      resolvedVariables: resolved.details,
    });
  }

  return {
    total: params.rows.length,
    validCount,
    invalidCount,
    blockedCount,
    rows: previewRows,
  };
}

function buildPreparedBatchCandidates(params: {
  rows: Record<string, string>[];
  mapping: BatchMappingDto;
  template: WhatsAppTemplateCatalogItem;
  enterprise: { id: number; name: string } | null;
  selectedBrokers: Array<{ id: number; fullName: string }>;
}): PreparedBatchCandidatesResult {
  const blockedDetails: BatchExecutionResult['details'] = [];
  const candidates: PreparedBatchCandidate[] = [];
  let roundRobinIndex = 0;

  for (let i = 0; i < params.rows.length; i++) {
    const row = params.rows[i];
    const rowNumber = i + 2;
    const phoneOriginal = normalizeValue(row[params.mapping.phoneColumn]);
    const phone = normalizePhoneStrict(phoneOriginal);
    const resolved = resolveVariablesForRow({
      row,
      template: params.template,
      mapping: params.mapping,
      enterprise: params.enterprise,
    });

    if (phone.error) {
      blockedDetails.push({
        rowNumber,
        phoneOriginal,
        phoneNormalized: null,
        status: 'blocked',
        error: phone.error,
        templateKey: params.template.key,
      });
      continue;
    }

    if (resolved.missingRequired) {
      blockedDetails.push({
        rowNumber,
        phoneOriginal,
        phoneNormalized: phone.phoneNormalized,
        status: 'blocked',
        error: 'Variáveis obrigatórias não resolvidas.',
        templateKey: params.template.key,
      });
      continue;
    }

    const normalizedPhone = phone.phoneNormalized;
    if (!normalizedPhone) {
      blockedDetails.push({
        rowNumber,
        phoneOriginal,
        phoneNormalized: null,
        status: 'blocked',
        error: 'Telefone inválido após normalização.',
        templateKey: params.template.key,
      });
      continue;
    }

    const assignedBroker =
      params.selectedBrokers.length > 0
        ? params.selectedBrokers[roundRobinIndex % params.selectedBrokers.length] ?? null
        : null;
    if (params.selectedBrokers.length > 0) roundRobinIndex++;
    candidates.push({
      rowNumber,
      phoneOriginal,
      phoneNormalized: normalizedPhone,
      resolvedValues: resolved.values,
      assignedBrokerId: assignedBroker?.id ?? null,
      assignedBrokerName: assignedBroker?.fullName ?? null,
    });
  }

  return { candidates, blockedDetails };
}

async function applyBatchOwnershipAndContextByPhone(params: {
  phoneE164: string;
  enterpriseId: number | null;
  brokerId: number | null;
  sourceKey: string;
  sourceRowNumber: number;
}): Promise<void> {
  await query(
    `UPDATE contacts
     SET owner_user_id = COALESCE($2, owner_user_id),
         owner_assigned_at = CASE WHEN $2 IS NULL THEN owner_assigned_at ELSE NOW() END,
         owner_assignment_source = CASE WHEN $2 IS NULL THEN owner_assignment_source ELSE 'whatsapp_batch_base' END,
         owner_assigned_by_user_id = NULL,
         updated_at = NOW()
     WHERE phone_e164 = $1`,
    [params.phoneE164, params.brokerId]
  );

  if (params.enterpriseId != null) {
    await query(
      `UPDATE contacts c
       SET enterprise_id = $2,
           enterprise_interest = e.name,
           updated_at = NOW()
       FROM enterprises e
       WHERE c.phone_e164 = $1
         AND e.id = $2`,
      [params.phoneE164, params.enterpriseId]
    );
  }

  await query(
    `UPDATE conversations c
     SET enterprise_id = COALESCE($2::int, c.enterprise_id),
         enterprise_origin_id = COALESCE($2::int, c.enterprise_origin_id),
         assigned_broker_id = COALESCE($5, c.assigned_broker_id),
         lead_source_raw = COALESCE(c.lead_source_raw, '{}'::jsonb) || jsonb_build_object(
             'source', 'batch_template_send',
             'sourceKey', $3::text,
            'rowNumber', $4::integer,
            'brokerId', $5::integer
           ),
         updated_at = NOW()
     WHERE regexp_replace(COALESCE(c.contact_phone, c.external_contact_id, ''), '\\D', '', 'g') = $1`,
    [params.phoneE164, params.enterpriseId, params.sourceKey, params.sourceRowNumber, params.brokerId]
  );
}

async function applyBatchConversationRouting(params: {
  conversationId: number;
  contactId: number | null;
  conversationType: NormalizedBatchConversationType;
  postSendMode: NormalizedBatchPostSendMode;
  brokerId: number | null;
}): Promise<void> {
  await updateConversationType(params.conversationId, params.conversationType);
  if (params.contactId != null) {
    await updateContactType(params.contactId, params.conversationType === 'ADMIN' ? 'INTERNO' : 'CLIENT');
  }
  await updateClassification(params.conversationId, {
    handoff: params.postSendMode === 'HANDOFF',
    assigned_broker_id: params.brokerId,
  });
}

async function sendBatchCandidateNow(params: {
  template: WhatsAppTemplateCatalogItem;
  candidate: PreparedBatchCandidate;
  configPhoneNumberId: string | null;
  enterpriseId: number | null;
  conversationType: NormalizedBatchConversationType;
  postSendMode: NormalizedBatchPostSendMode;
  sourceKeyPrefix: string;
}): Promise<BatchExecutionResult['details'][number]> {
  // O template inicial foi solicitado por um operador. Ele pode ser entregue
  // mesmo em handoff, mas nunca pode reativar automações posteriores da Ana.
  const existingConversationResult = await query<BatchPersistedConversationState>(
    `SELECT id, contact_id, handoff, classification
       FROM conversations
      WHERE regexp_replace(COALESCE(contact_phone, external_contact_id, ''), '\\D', '', 'g') = $1
      ORDER BY updated_at DESC, id DESC
      LIMIT 1`,
    [params.candidate.phoneNormalized]
  );
  const existingConversation = existingConversationResult.rows[0] ?? null;
  const source = params.sourceKeyPrefix.startsWith('scheduled_batch:')
    ? 'scheduled_batch'
    : 'immediate_batch';
  const deliveryDecision = resolveBatchHandoffDeliveryDecision({
    sourceKeyPrefix: params.sourceKeyPrefix,
    requestedPostSendMode: params.postSendMode,
    conversation: existingConversation,
  });
  if (!deliveryDecision.allowed) {
    console.log('[WHATSAPP_BATCH_SCHEDULED_AUTOMATION_BLOCKED]', {
      conversationId: existingConversation?.id ?? null,
      contactId: existingConversation?.contact_id ?? null,
      source,
      reason: deliveryDecision.reason,
    });
    return {
      rowNumber: params.candidate.rowNumber,
      phoneOriginal: params.candidate.phoneOriginal,
      phoneNormalized: params.candidate.phoneNormalized,
      status: 'blocked',
      error: `Envio agendado bloqueado: conversa em ${deliveryDecision.reason}.`,
      templateKey: params.template.key,
    };
  }

  const existingConversationInHandoff = isAnaAutomationBlockedByHandoff(existingConversation);
  const effectivePostSendMode = deliveryDecision.effectivePostSendMode;
  if (existingConversationInHandoff) {
    if (params.postSendMode !== 'HANDOFF') {
      console.log('[WHATSAPP_BATCH_OPERATOR_SEND_HANDOFF_PRESERVED]', {
        conversationId: existingConversation!.id,
        contactId: existingConversation!.contact_id ?? null,
        requestedPostSendMode: params.postSendMode,
        effectivePostSendMode: 'HANDOFF',
        source,
        reason: 'OPERATOR_SEND_ALLOWED_HANDOFF_PRESERVED',
      });
    }
    console.log('[WHATSAPP_BATCH_INITIAL_TEMPLATE_HANDOFF_ALLOWED]', {
      conversationId: existingConversation!.id,
      contactId: existingConversation!.contact_id ?? null,
      deliveryKind: 'operator_requested_initial_batch',
      postSendMode: params.postSendMode,
      source,
    });
  }
  const result = await sendTemplateMessage(params.candidate.phoneNormalized, params.template.key, {
    parameters: params.candidate.resolvedValues,
  });
  if (!result.success) {
    return {
      rowNumber: params.candidate.rowNumber,
      phoneOriginal: params.candidate.phoneOriginal,
      phoneNormalized: params.candidate.phoneNormalized,
      status: 'error',
      error: result.error ?? 'Falha no envio.',
      errorCode: result.metaErrorCode ?? result.code,
      errorType: result.metaErrorType,
      httpStatus: result.httpStatus,
      templateKey: params.template.key,
    };
  }

  const contact = await findOrCreateContactByPhone({
    phoneE164: params.candidate.phoneNormalized,
    phoneDisplay: params.candidate.phoneNormalized,
    source: 'whatsapp',
  });

  const conversation = await findOrCreateConversation(
    'whatsapp',
    params.candidate.phoneNormalized,
    params.candidate.phoneNormalized,
    params.configPhoneNumberId,
    null,
    null
  );
  const conversationInHandoffAfterSend =
    isAnaAutomationBlockedByHandoff(conversation);

  const routingPostSendMode = conversationInHandoffAfterSend
    ? 'HANDOFF'
    : effectivePostSendMode;

  if (
    conversationInHandoffAfterSend &&
    routingPostSendMode !== effectivePostSendMode
  ) {
    console.log('[WHATSAPP_BATCH_OPERATOR_SEND_HANDOFF_PRESERVED]', {
      conversationId: conversation.id,
      phoneTail: params.candidate.phoneNormalized.slice(-4),
      requestedPostSendMode: params.postSendMode,
      effectivePostSendMode: routingPostSendMode,
      handoff: conversation.handoff === true,
      classification: conversation.classification ?? null,
    });
  }

  await applyBatchConversationRouting({
    conversationId: conversation.id,
    contactId: contact.id,
    conversationType: params.conversationType,
    postSendMode: routingPostSendMode,
    brokerId: params.candidate.assignedBrokerId,
  });

  if (result.metaMessageId) {
    const inboxContent = renderTemplateTextForInbox(params.template, params.candidate.resolvedValues);
    await insertMessage(conversation.id, 'assistant', inboxContent, result.metaMessageId);
  }

  await applyBatchOwnershipAndContextByPhone({
    phoneE164: params.candidate.phoneNormalized,
    enterpriseId: params.enterpriseId,
    brokerId: params.candidate.assignedBrokerId,
    sourceKey: `${params.sourceKeyPrefix}:${params.template.key}`,
    sourceRowNumber: params.candidate.rowNumber,
  });

  return {
    rowNumber: params.candidate.rowNumber,
    phoneOriginal: params.candidate.phoneOriginal,
    phoneNormalized: params.candidate.phoneNormalized,
    status: 'sent',
    error: null,
    templateKey: params.template.key,
    metaMessageId: result.metaMessageId,
  };
}

export async function sendBatchTemplate(params: {
  rows: Record<string, string>[];
  mapping: BatchMappingDto;
  conversationType?: BatchConversationType;
  postSendMode?: BatchPostSendMode;
  sendMode?: BatchSendMode;
  scheduledAt?: string | null;
  createdByUserId?: number | null;
}): Promise<BatchSendResult> {
  const conversationType = normalizeConversationType(params.conversationType);
  const postSendMode = normalizePostSendMode(params.postSendMode);
  const sendMode = normalizeSendMode(params.sendMode);

  if (sendMode === 'SCHEDULED') {
    return scheduleBatchTemplate({
      rows: params.rows,
      mapping: params.mapping,
      conversationType,
      postSendMode,
      scheduledAt: params.scheduledAt ?? null,
      createdByUserId: params.createdByUserId ?? null,
    });
  }

  const template = getTemplateOrThrow(params.mapping.templateKey);
  assertTemplateApproved(template);
  assertTemplateHeaderMediaConfigured(template);
  const enterprise = await resolveEnterprise(params.mapping.selectedEnterpriseId);
  const selectedBrokers = await resolveSelectedBrokers(params.mapping);
  const config = await getWhatsAppConfig();
  const prepared = buildPreparedBatchCandidates({
    rows: params.rows,
    mapping: params.mapping,
    template,
    enterprise,
    selectedBrokers,
  });

  if (prepared.candidates.length === 0) {
    throw new Error('Nenhum número válido para envio.');
  }

  const details: BatchExecutionResult['details'] = [...prepared.blockedDetails];
  let success = 0;
  let failed = prepared.blockedDetails.length;

  for (const candidate of prepared.candidates) {
    const detail = await sendBatchCandidateNow({
      template,
      candidate,
      configPhoneNumberId: config?.whatsappPhoneNumberId ?? null,
      enterpriseId: enterprise?.id ?? null,
      conversationType,
      postSendMode,
      sourceKeyPrefix: 'batch',
    });
    details.push(detail);
    if (detail.status === 'sent') success++;
    else failed++;
  }

  return {
    total: params.rows.length,
    success,
    failed,
    details,
  };
}

async function scheduleBatchTemplate(params: {
  rows: Record<string, string>[];
  mapping: BatchMappingDto;
  conversationType: NormalizedBatchConversationType;
  postSendMode: NormalizedBatchPostSendMode;
  scheduledAt: string | null;
  createdByUserId: number | null;
}): Promise<BatchScheduleResult> {
  const template = getTemplateOrThrow(params.mapping.templateKey);
  assertTemplateApproved(template);
  assertTemplateHeaderMediaConfigured(template);
  const enterprise = await resolveEnterprise(params.mapping.selectedEnterpriseId);
  const selectedBrokers = await resolveSelectedBrokers(params.mapping);
  const scheduledAt = parseScheduledAtOrThrow(params.scheduledAt);
  const prepared = buildPreparedBatchCandidates({
    rows: params.rows,
    mapping: params.mapping,
    template,
    enterprise,
    selectedBrokers,
  });

  if (prepared.candidates.length === 0) {
    throw new Error('Nenhum número válido para agendamento.');
  }

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const payloadJson = {
      mapping: params.mapping,
      rowsCount: params.rows.length,
      validRecipients: prepared.candidates.length,
      invalidRecipients: prepared.blockedDetails.length,
    };
    const batchInsert = await client.query<{
      id: number;
      scheduled_at: Date;
    }>(
      `INSERT INTO whatsapp_batch_scheduled_sends (
         enterprise_id,
         template_key,
         payload_json,
         conversation_type,
         post_send_mode,
         scheduled_at,
         status,
         created_by,
         created_at,
         updated_at
       ) VALUES ($1, $2, $3::jsonb, $4, $5, $6, 'PENDING', $7, NOW(), NOW())
       RETURNING id, scheduled_at`,
      [
        enterprise?.id ?? null,
        template.key,
        JSON.stringify(payloadJson),
        params.conversationType,
        params.postSendMode,
        scheduledAt.toISOString(),
        params.createdByUserId,
      ]
    );
    const batchId = batchInsert.rows[0]?.id;
    if (!batchId) {
      throw new Error('Falha ao criar lote agendado.');
    }
    for (const candidate of prepared.candidates) {
      await client.query(
        `INSERT INTO whatsapp_batch_scheduled_send_recipients (
           batch_id,
           row_number,
           phone,
           name,
           variables_json,
           assigned_broker_id,
           status,
           created_at,
           updated_at
         ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, 'PENDING', NOW(), NOW())`,
        [
          batchId,
          candidate.rowNumber,
          candidate.phoneNormalized,
          candidate.assignedBrokerName,
          JSON.stringify(candidate.resolvedValues),
          candidate.assignedBrokerId,
        ]
      );
    }
    await client.query('COMMIT');
    return {
      scheduled: true,
      batchId,
      status: 'PENDING',
      total: params.rows.length,
      validRecipients: prepared.candidates.length,
      invalidRecipients: prepared.blockedDetails.length,
      scheduledAt: (batchInsert.rows[0]?.scheduled_at ?? scheduledAt).toISOString(),
      conversationType: params.conversationType,
      postSendMode: params.postSendMode,
      message: 'Lote agendado com sucesso.',
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function parseScheduledRecipientVariables(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((value) => String(value ?? ''));
}

async function finalizeScheduledBatch(batchId: number): Promise<void> {
  const summary = await query<{
    total: string;
    sent_count: string;
    failed_count: string;
  }>(
    `SELECT
       COUNT(*)::text AS total,
       COUNT(*) FILTER (WHERE status = 'SENT')::text AS sent_count,
       COUNT(*) FILTER (WHERE status IN ('FAILED', 'CANCELED'))::text AS failed_count
     FROM whatsapp_batch_scheduled_send_recipients
     WHERE batch_id = $1`,
    [batchId]
  );
  const totals = summary.rows[0];
  const total = Number(totals?.total ?? 0);
  const sent = Number(totals?.sent_count ?? 0);
  const failed = Number(totals?.failed_count ?? 0);
  const finalStatus =
    total > 0 && sent === total
      ? 'SENT'
      : sent > 0
        ? 'PARTIAL_FAILED'
        : 'FAILED';
  await query(
    `UPDATE whatsapp_batch_scheduled_sends
     SET status = $1,
         finished_at = NOW(),
         updated_at = NOW(),
         error_message = CASE
           WHEN $2::int > 0 THEN CONCAT('Falhas em ', $2::text, ' destinatário(s).')
           ELSE NULL
         END
     WHERE id = $3`,
    [finalStatus, failed, batchId]
  );
}

async function processClaimedScheduledBatch(batch: ScheduledBatchRow): Promise<void> {
  try {
    const template = getTemplateOrThrow(batch.template_key);
    assertTemplateApproved(template);
    assertTemplateHeaderMediaConfigured(template);
    const config = await getWhatsAppConfig();

    const recipientsRes = await query<ScheduledBatchRecipientRow>(
      `SELECT id, batch_id, row_number, phone, name, variables_json, assigned_broker_id, status
       FROM whatsapp_batch_scheduled_send_recipients
       WHERE batch_id = $1 AND status = 'PENDING'
       ORDER BY id ASC`,
      [batch.id]
    );
    for (const recipient of recipientsRes.rows) {
      const claimRes = await query<ScheduledBatchRecipientRow>(
        `UPDATE whatsapp_batch_scheduled_send_recipients
         SET status = 'PROCESSING', updated_at = NOW()
         WHERE id = $1 AND status = 'PENDING'
         RETURNING id, batch_id, row_number, phone, name, variables_json, assigned_broker_id, status`,
        [recipient.id]
      );
      const claimed = claimRes.rows[0];
      if (!claimed) continue;

      const detail = await sendBatchCandidateNow({
        template,
        candidate: {
          rowNumber: claimed.row_number,
          phoneOriginal: claimed.phone,
          phoneNormalized: claimed.phone,
          resolvedValues: parseScheduledRecipientVariables(claimed.variables_json),
          assignedBrokerId: claimed.assigned_broker_id ?? null,
          assignedBrokerName: claimed.name ?? null,
        },
        configPhoneNumberId: config?.whatsappPhoneNumberId ?? null,
        enterpriseId: batch.enterprise_id ?? null,
        conversationType: normalizeConversationType(batch.conversation_type),
        postSendMode: normalizePostSendMode(batch.post_send_mode),
        sourceKeyPrefix: `scheduled_batch:${batch.id}`,
      });

      if (detail.status === 'sent') {
        await query(
          `UPDATE whatsapp_batch_scheduled_send_recipients
           SET status = 'SENT',
               sent_at = NOW(),
               updated_at = NOW(),
               error_message = NULL,
               conversation_id = (
                 SELECT id
                 FROM conversations
                 WHERE regexp_replace(COALESCE(contact_phone, external_contact_id, ''), '\\D', '', 'g') = $1
                 ORDER BY updated_at DESC
                 LIMIT 1
               )
           WHERE id = $2`,
          [claimed.phone, claimed.id]
        );
      } else {
        await query(
          `UPDATE whatsapp_batch_scheduled_send_recipients
           SET status = $1,
               updated_at = NOW(),
               error_message = LEFT($2, 1000)
           WHERE id = $3`,
          [
            detail.status === 'blocked' ? 'CANCELED' : 'FAILED',
            detail.error ?? 'Falha no envio do destinatário agendado.',
            claimed.id,
          ]
        );
      }
    }

    await finalizeScheduledBatch(batch.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro inesperado no processamento do lote agendado.';
    await query(
      `UPDATE whatsapp_batch_scheduled_sends
       SET status = 'FAILED',
           finished_at = NOW(),
           updated_at = NOW(),
           error_message = LEFT($2, 2000)
       WHERE id = $1`,
      [batch.id, message]
    );
    await query(
      `UPDATE whatsapp_batch_scheduled_send_recipients
       SET status = 'FAILED',
           updated_at = NOW(),
           error_message = LEFT($2, 1000)
       WHERE batch_id = $1 AND status IN ('PENDING', 'PROCESSING')`,
      [batch.id, message]
    );
  }
}

export async function processDueScheduledBatchSends(limit = 5): Promise<number> {
  const dueBatches = await query<{ id: number }>(
    `SELECT id
     FROM whatsapp_batch_scheduled_sends
     WHERE status = 'PENDING' AND scheduled_at <= NOW()
     ORDER BY scheduled_at ASC, id ASC
     LIMIT $1`,
    [Math.max(1, Math.min(50, limit))]
  );
  let processed = 0;
  for (const row of dueBatches.rows) {
    const claim = await query<ScheduledBatchRow>(
      `UPDATE whatsapp_batch_scheduled_sends
       SET status = 'PROCESSING',
           started_at = COALESCE(started_at, NOW()),
           updated_at = NOW(),
           error_message = NULL
       WHERE id = $1 AND status = 'PENDING'
       RETURNING id, enterprise_id, template_key, payload_json, conversation_type, post_send_mode, scheduled_at, status`,
      [row.id]
    );
    const claimed = claim.rows[0];
    if (!claimed) continue;
    processed++;
    await processClaimedScheduledBatch(claimed);
  }
  return processed;
}

export async function sendBatchTemplateTest(params: {
  rows: Record<string, string>[];
  mapping: BatchMappingDto;
  testPhone: string;
  mode: 'row' | 'manual';
  sampleRowIndex?: number;
  manualVariables?: Record<string, string>;
}): Promise<{
  success: boolean;
  phoneOriginal: string;
  phoneNormalized: string | null;
  error: string | null;
  templateKey: string;
  mode: 'row' | 'manual';
  sampleRowNumber?: number;
  resolvedVariables: BatchPreviewRow['resolvedVariables'];
  errorCode?: number;
  errorType?: string;
  httpStatus?: number;
  metaMessageId?: string;
}> {
  const template = getTemplateOrThrow(params.mapping.templateKey);
  assertTemplateApproved(template);
  assertTemplateHeaderMediaConfigured(template);
  const enterprise = await resolveEnterprise(params.mapping.selectedEnterpriseId);
  let resolved: ReturnType<typeof resolveVariablesForRow>;
  let sampleRowNumber: number | undefined;

  if (params.mode === 'row') {
    if (params.sampleRowIndex == null) {
      return {
        success: false,
        phoneOriginal: params.testPhone,
        phoneNormalized: null,
        error: 'Selecione uma linha válida para o envio de teste.',
        templateKey: template.key,
        mode: 'row',
        resolvedVariables: [],
      };
    }
    const sampleRow = params.rows[params.sampleRowIndex];
    if (!sampleRow) {
      return {
        success: false,
        phoneOriginal: params.testPhone,
        phoneNormalized: null,
        error: 'Linha de teste inválida para a planilha atual.',
        templateKey: template.key,
        mode: 'row',
        resolvedVariables: [],
      };
    }
    resolved = resolveVariablesForRow({
      row: sampleRow,
      template,
      mapping: params.mapping,
      enterprise,
    });
    sampleRowNumber = params.sampleRowIndex + 2;
  } else {
    const details: BatchPreviewRow['resolvedVariables'] = [];
    const values: string[] = [];
    let missingRequired = false;
    const manualVariables = params.manualVariables ?? {};

    for (const variable of template.variables) {
      const value = normalizeValue(manualVariables[String(variable.id)]);
      if (!value && variable.required) missingRequired = true;
      details.push({
        variableId: variable.id,
        label: variable.label,
        value,
        sourceType: 'fixed',
        sourceLabel: 'preenchimento manual',
      });
      values.push(value ?? '');
    }

    resolved = { values, details, missingRequired };
  }

  if (resolved.missingRequired) {
    return {
      success: false,
      phoneOriginal: params.testPhone,
      phoneNormalized: null,
      error: 'Variáveis obrigatórias não resolvidas para envio de teste.',
      templateKey: template.key,
      mode: params.mode,
      sampleRowNumber,
      resolvedVariables: resolved.details,
    };
  }
  const phone = normalizePhoneStrict(params.testPhone);
  if (phone.error || !phone.phoneNormalized) {
    return {
      success: false,
      phoneOriginal: params.testPhone,
      phoneNormalized: null,
      error: phone.error ?? 'Telefone inválido.',
      templateKey: template.key,
      mode: params.mode,
      sampleRowNumber,
      resolvedVariables: resolved.details,
    };
  }
  const result = await sendTemplateMessage(phone.phoneNormalized, template.key, {
    parameters: resolved.values,
  });
  return {
    success: result.success,
    phoneOriginal: params.testPhone,
    phoneNormalized: phone.phoneNormalized,
    error: result.success ? null : result.error ?? 'Falha no envio de teste.',
    templateKey: template.key,
    mode: params.mode,
    sampleRowNumber,
    resolvedVariables: resolved.details,
    errorCode: result.metaErrorCode ?? result.code,
    errorType: result.metaErrorType,
    httpStatus: result.httpStatus,
    metaMessageId: result.metaMessageId,
  };
}

