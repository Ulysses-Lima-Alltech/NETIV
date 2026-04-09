import { query } from '../db/pg.js';
import { getWhatsAppTemplateByKey, type WhatsAppTemplateCatalogItem } from '../catalogs/whatsappTemplates.js';
import { detectBatchColumns, type BatchColumnSuggestions } from '../utils/columnDetection.js';
import { normalizePhoneE164 } from '../utils/phone.js';
import type { BatchMappingDto } from '../validators/whatsappBatch.js';
import { getEnterpriseById } from '../repositories/enterpriseRepository.js';
import { findOrCreateConversation } from '../repositories/conversationRepository.js';
import { getWhatsAppConfig } from '../repositories/whatsappConfigRepository.js';
import { sendTemplateMessage } from './whatsappMetaService.js';

export interface BatchPreviewRow {
  rowNumber: number;
  phoneOriginal: string | null;
  phoneNormalized: string | null;
  isValid: boolean;
  status: 'valid' | 'invalid' | 'blocked';
  error: string | null;
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
  if (!template) throw new Error('Template inválido.');
  return template;
}

async function resolveEnterprise(selectedEnterpriseId: number | null | undefined): Promise<{ id: number; name: string } | null> {
  if (selectedEnterpriseId == null) return null;
  const ent = await getEnterpriseById(selectedEnterpriseId);
  if (!ent || ent.status !== 'ativo') throw new Error('Empreendimento selecionado é inválido ou inativo.');
  return { id: ent.id, name: ent.name };
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
      const value = normalizeValue(params.row[mappingItem.columnName]);
      if (!value && variable.required) missingRequired = true;
      details.push({
        variableId: variable.id,
        label: variable.label,
        value,
        sourceType: 'column',
        sourceLabel: `coluna: ${mappingItem.columnName}`,
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
  const enterprise = await resolveEnterprise(params.mapping.selectedEnterpriseId);
  const previewRows: BatchPreviewRow[] = [];
  let validCount = 0;
  let invalidCount = 0;
  let blockedCount = 0;

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
    previewRows.push({
      rowNumber: i + 2,
      phoneOriginal,
      phoneNormalized: phone.phoneNormalized,
      isValid: true,
      status: 'valid',
      error: null,
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

async function applyEnterpriseLinkByPhone(params: {
  phoneE164: string;
  enterpriseId: number;
  sourceKey: string;
  sourceRowNumber: number;
}): Promise<void> {
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

  await query(
    `UPDATE conversations c
     SET enterprise_id = COALESCE(c.enterprise_id, $2),
         enterprise_origin_id = COALESCE(c.enterprise_origin_id, $2),
         lead_source_raw = COALESCE(
           c.lead_source_raw,
           jsonb_build_object(
             'source', 'batch_template_send',
             'sourceKey', $3,
             'rowNumber', $4
           )
         ),
         updated_at = NOW()
     WHERE regexp_replace(COALESCE(c.contact_phone, c.external_contact_id, ''), '\D', '', 'g') = $1`,
    [params.phoneE164, params.enterpriseId, params.sourceKey, params.sourceRowNumber]
  );
}

export async function sendBatchTemplate(params: {
  rows: Record<string, string>[];
  mapping: BatchMappingDto;
}): Promise<BatchExecutionResult> {
  const template = getTemplateOrThrow(params.mapping.templateKey);
  const enterprise = await resolveEnterprise(params.mapping.selectedEnterpriseId);
  const config = await getWhatsAppConfig();
  const details: BatchExecutionResult['details'] = [];
  let success = 0;
  let failed = 0;
  let validCandidates = 0;

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

    if (config?.whatsappPhoneNumberId) {
      await findOrCreateConversation(
        'whatsapp',
        normalizedPhone,
        normalizedPhone,
        config.whatsappPhoneNumberId,
        null,
        null
      );
    }
    if (enterprise) {
      await applyEnterpriseLinkByPhone({
        phoneE164: normalizedPhone,
        enterpriseId: enterprise.id,
        sourceKey: `batch:${template.key}`,
        sourceRowNumber: rowNumber,
      });
    }
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
  sampleRowIndex?: number;
}): Promise<{
  success: boolean;
  phoneOriginal: string;
  phoneNormalized: string | null;
  error: string | null;
  templateKey: string;
  errorCode?: number;
  errorType?: string;
  httpStatus?: number;
  metaMessageId?: string;
}> {
  const template = getTemplateOrThrow(params.mapping.templateKey);
  const enterprise = await resolveEnterprise(params.mapping.selectedEnterpriseId);
  const idx = params.sampleRowIndex ?? 0;
  const sampleRow = params.rows[idx] ?? params.rows[0] ?? {};
  const resolved = resolveVariablesForRow({
    row: sampleRow,
    template,
    mapping: params.mapping,
    enterprise,
  });
  if (resolved.missingRequired) {
    return {
      success: false,
      phoneOriginal: params.testPhone,
      phoneNormalized: null,
      error: 'Variáveis obrigatórias não resolvidas para envio de teste.',
      templateKey: template.key,
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
    errorCode: result.metaErrorCode ?? result.code,
    errorType: result.metaErrorType,
    httpStatus: result.httpStatus,
    metaMessageId: result.metaMessageId,
  };
}
