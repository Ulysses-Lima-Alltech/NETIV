import { query } from '../db/pg.js';
import {
  getWhatsAppTemplateByKey,
  renderTemplateTextForInbox,
  type WhatsAppTemplateCatalogItem,
} from '../catalogs/whatsappTemplates.js';
import { detectBatchColumns, type BatchColumnSuggestions } from '../utils/columnDetection.js';
import { normalizePhoneE164 } from '../utils/phone.js';
import type { BatchMappingDto } from '../validators/whatsappBatch.js';
import { getEnterpriseById } from '../repositories/enterpriseRepository.js';
import { findOrCreateConversation, updateConversationType } from '../repositories/conversationRepository.js';
import { insertMessage } from '../repositories/messageRepository.js';
import { getWhatsAppConfig } from '../repositories/whatsappConfigRepository.js';
import { sendTemplateMessage } from './whatsappMetaService.js';
import { getCorretorById } from '../repositories/corretorRepository.js';
import { findOrCreateContactByPhone, updateContactType } from '../repositories/contactsRepository.js';
import { isProtectedClientPhone } from '../utils/protectedClientPhone.js';

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
  if (selectedBrokers.length === 0) {
    throw new Error('Selecione ao menos um corretor responsável para gerar o preview.');
  }
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
    const assignedBroker = selectedBrokers[roundRobinIndex % selectedBrokers.length];
    roundRobinIndex++;
    previewRows.push({
      rowIndex: i,
      rowNumber: i + 2,
      phoneOriginal,
      phoneNormalized: phone.phoneNormalized,
      isValid: true,
      status: 'valid',
      error: null,
      assignedBrokerId: assignedBroker.id,
      assignedBrokerName: assignedBroker.fullName,
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

export async function sendBatchTemplate(params: {
  rows: Record<string, string>[];
  mapping: BatchMappingDto;
}): Promise<BatchExecutionResult> {
  const template = getTemplateOrThrow(params.mapping.templateKey);
  assertTemplateApproved(template);
  assertTemplateHeaderMediaConfigured(template);
  const enterprise = await resolveEnterprise(params.mapping.selectedEnterpriseId);
  const selectedBrokers = await resolveSelectedBrokers(params.mapping);
  if (selectedBrokers.length === 0) {
    throw new Error('Selecione ao menos um corretor responsável para enviar em lote.');
  }
  const config = await getWhatsAppConfig();
  const details: BatchExecutionResult['details'] = [];
  let success = 0;
  let failed = 0;
  let validCandidates = 0;
  let roundRobinIndex = 0;

  for (let i = 0; i < params.rows.length; i++) {
    const row = params.rows[i];
    const rowNumber = i + 2;
    const phoneOriginal = normalizeValue(row[params.mapping.phoneColumn]);
    const phone = normalizePhoneStrict(phoneOriginal);
    const resolved = resolveVariablesForRow({
      row,
      template,
      mapping: params.mapping,
      enterprise,
    });

    if (phone.error) {
      failed++;
      details.push({
        rowNumber,
        phoneOriginal,
        phoneNormalized: null,
        status: 'blocked',
        error: phone.error,
        templateKey: template.key,
      });
      continue;
    }
    if (resolved.missingRequired) {
      failed++;
      details.push({
        rowNumber,
        phoneOriginal,
        phoneNormalized: phone.phoneNormalized,
        status: 'blocked',
        error: 'Variáveis obrigatórias não resolvidas.',
        templateKey: template.key,
      });
      continue;
    }

    const normalizedPhone = phone.phoneNormalized;
    if (!normalizedPhone) {
      failed++;
      details.push({
        rowNumber,
        phoneOriginal,
        phoneNormalized: null,
        status: 'blocked',
        error: 'Telefone inválido após normalização.',
        templateKey: template.key,
      });
      continue;
    }

    validCandidates++;
    const assignedBroker = selectedBrokers[roundRobinIndex % selectedBrokers.length];
    roundRobinIndex++;
    const result = await sendTemplateMessage(normalizedPhone, template.key, {
      parameters: resolved.values,
    });
    if (!result.success) {
      failed++;
      details.push({
        rowNumber,
        phoneOriginal,
        phoneNormalized: normalizedPhone,
        status: 'error',
        error: result.error ?? 'Falha no envio.',
        errorCode: result.metaErrorCode ?? result.code,
        errorType: result.metaErrorType,
        httpStatus: result.httpStatus,
        templateKey: template.key,
      });
      continue;
    }

    success++;
    details.push({
      rowNumber,
      phoneOriginal,
      phoneNormalized: normalizedPhone,
      status: 'sent',
      error: null,
      templateKey: template.key,
      metaMessageId: result.metaMessageId,
    });

    const contact = await findOrCreateContactByPhone({
      phoneE164: normalizedPhone,
      phoneDisplay: normalizedPhone,
      source: 'whatsapp',
    });
    const shouldAutoClassifyAsInternal = template.category === 'CORRETOR' || template.category === 'ADMIN';
    const protectedPhone = isProtectedClientPhone(normalizedPhone);
    if (shouldAutoClassifyAsInternal && protectedPhone) {
      console.warn('[INTERNAL_CLASSIFICATION_BLOCKED_FOR_PROTECTED_PHONE]', {
        phoneTail: normalizedPhone.slice(-4),
        templateKey: template.key,
        category: template.category,
      });
    } else if (shouldAutoClassifyAsInternal) {
      await updateContactType(contact.id, 'INTERNO');
    }

    if (config?.whatsappPhoneNumberId) {
      const conversation = await findOrCreateConversation(
        'whatsapp',
        normalizedPhone,
        normalizedPhone,
        config.whatsappPhoneNumberId,
        null,
        null
      );
      if (template.category === 'CORRETOR' && !protectedPhone) {
        await updateConversationType(conversation.id, 'CORRETOR');
      }
      if (result.metaMessageId) {
        const inboxContent = renderTemplateTextForInbox(template, resolved.values);
        await insertMessage(conversation.id, 'assistant', inboxContent, result.metaMessageId);
      }
    }
    await applyBatchOwnershipAndContextByPhone({
      phoneE164: normalizedPhone,
      enterpriseId: enterprise?.id ?? null,
      brokerId: assignedBroker.id,
      sourceKey: `batch:${template.key}`,
      sourceRowNumber: rowNumber,
    });
  }

  if (validCandidates === 0) {
    throw new Error('Nenhum número válido para envio.');
  }

  return {
    total: params.rows.length,
    success,
    failed,
    details,
  };
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

