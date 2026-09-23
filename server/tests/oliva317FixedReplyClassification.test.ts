import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function readWebhookSource(): string {
  try {
    return readFileSync(new URL('../services/webhookProcessor.ts', import.meta.url), 'utf8');
  } catch {
    return readFileSync(new URL('../services/webhookProcessor.js', import.meta.url), 'utf8');
  }
}

function textFixedReplyBranch(source: string): string {
  const textStart = source.indexOf('const text = effectiveText');
  const branchStart = source.indexOf('if (globalFixedReplyEnabled) {', textStart);
  const branchEnd = source.indexOf('if (await shouldBlockAnaWebhookAutomation', branchStart);
  assert.ok(textStart >= 0, 'text branch not found');
  assert.ok(branchStart > textStart, 'text fixed-reply branch not found');
  assert.ok(branchEnd > branchStart, 'text fixed-reply branch end not found');
  return source.slice(branchStart, branchEnd);
}

function classifierHelper(source: string): string {
  const start = source.indexOf('async function classifyLeadForInboundText');
  const end = source.indexOf('function anaWebhookTrace', start);
  assert.ok(start >= 0, 'classifier helper not found');
  assert.ok(end > start, 'classifier helper end not found');
  return source.slice(start, end);
}

test('oliva317 com fixed reply: mensagem de texto resolve empreendimento, classifica e depois envia resposta fixa', () => {
  const source = readWebhookSource();
  const branch = textFixedReplyBranch(source);

  assert.match(source, /const OLIVA317_ENTERPRISE_ID = 12;/);
  assert.match(branch, /conv = await resolveAnaEnterpriseBeforeEngine/);
  assert.match(branch, /if \(conv\.enterprise_id === OLIVA317_ENTERPRISE_ID\)/);
  assert.match(branch, /await classifyLeadForInboundText\(\{ conversation: conv, text \}\)/);
  assert.match(branch, /await sendGlobalFixedWhatsappReply/);
  assert.ok(branch.indexOf('conv = await resolveAnaEnterpriseBeforeEngine') < branch.indexOf('await classifyLeadForInboundText'));
  assert.ok(branch.indexOf('await classifyLeadForInboundText') < branch.indexOf('await sendGlobalFixedWhatsappReply'));
});

test('fixed reply desabilitado continua no fluxo normal de classificacao e agendamento', () => {
  const source = readWebhookSource();
  const normalFlow = source.slice(source.indexOf('if (await shouldBlockAnaWebhookAutomation'));

  assert.match(normalFlow, /conv = await resolveAnaEnterpriseBeforeEngine/);
  assert.match(normalFlow, /await classifyLeadForInboundText\(\{ conversation: conv, text \}\)/);
  assert.match(normalFlow, /scheduleWhatsAppAiAfterUserMessage/);
});

test('classificacao usa os mesmos setters e auditoria do fluxo legado', () => {
  const helper = classifierHelper(readWebhookSource());

  assert.match(helper, /classifyLeadConversation/);
  assert.match(helper, /setConversationLeadTemperature/);
  assert.match(helper, /setConversationEnterpriseId/);
  assert.match(helper, /setConversationFunnelStatusAutomatic/);
  assert.match(helper, /saveLeadClassificationAudit/);
  assert.match(helper, /commercial_flow_state/);
  assert.match(helper, /manualOverrideFlags: manualOverrides/);
  assert.match(helper, /console\.error\('\[LEAD_CLASSIFICATION\] classify_or_persist_error'/);
});

test('Handoff e Carteira seguem protegidos pelo setter automatico de funil', () => {
  const repository = readFileSync(new URL('../repositories/conversationRepository.ts', import.meta.url), 'utf8');

  assert.match(repository, /export async function setConversationFunnelStatusAutomatic/);
  assert.match(repository, /if \(normalizedCurrent === 'Handoff' \|\| normalizedCurrent === 'Carteira'\) return conv;/);
  assert.match(repository, /if \(normalizedNext === 'Handoff' \|\| normalizedNext === 'Carteira'\) return conv;/);
});

test('overrides manuais continuam respeitados pelos setters reutilizados', () => {
  const repository = readFileSync(new URL('../repositories/conversationRepository.ts', import.meta.url), 'utf8');

  assert.match(repository, /manualOverrides\.temperature/);
  assert.match(repository, /manualOverrides\.enterprise/);
  assert.match(repository, /manualTemperatureOverrideRequested = u\.lead_temperature !== undefined/);
  assert.match(repository, /manualEnterpriseOverrideRequested = u\.enterprise_id !== undefined/);
});

test('remetente bloqueado continua saindo antes do fixed reply e da classificacao', () => {
  const source = readWebhookSource();
  const processor = source.slice(source.indexOf('export async function processIncomingWebhook'));

  assert.ok(processor.indexOf('filterBlockedWhatsappSenderMessages') < processor.indexOf('const globalFixedReplyEnabled'));
  assert.ok(processor.indexOf('if (!blockedSenderFilter.payload)') < processor.indexOf('const globalFixedReplyEnabled'));
  assert.ok(processor.indexOf('if (!blockedSenderFilter.payload)') < processor.indexOf('classifyLeadForInboundText'));
});

test('empreendimentos diferentes de oliva317 nao entram na classificacao extra do fixed reply', () => {
  const branch = textFixedReplyBranch(readWebhookSource());

  assert.match(branch, /if \(conv\.enterprise_id === OLIVA317_ENTERPRISE_ID\) \{/);
  assert.doesNotMatch(branch, /else\s*\{\s*await classifyLeadForInboundText/);
});

test('erro do classificador nao impede politica atual do fixed reply', () => {
  const source = readWebhookSource();
  const helper = classifierHelper(source);
  const branch = textFixedReplyBranch(source);

  assert.match(helper, /catch \(classificationError\)/);
  assert.match(helper, /console\.error\('\[LEAD_CLASSIFICATION\] classify_or_persist_error'/);
  assert.ok(branch.indexOf('await classifyLeadForInboundText') < branch.indexOf('await sendGlobalFixedWhatsappReply'));
});

test('multiplas mensagens nao rebaixam status terminal por reutilizar o setter guardado', () => {
  const source = readWebhookSource();
  const helper = classifierHelper(source);
  const repository = readFileSync(new URL('../repositories/conversationRepository.ts', import.meta.url), 'utf8');

  assert.match(helper, /setConversationFunnelStatusAutomatic/);
  assert.match(repository, /if \(normalizedNext === normalizedCurrent\) return conv;/);
  assert.match(repository, /if \(normalizedCurrent === 'Handoff' \|\| normalizedCurrent === 'Carteira'\) return conv;/);
});

test('auditoria lastLeadClassificationAudit e atualizada com valores antes e depois', () => {
  const helper = classifierHelper(readWebhookSource());
  const repository = readFileSync(new URL('../repositories/conversationRepository.ts', import.meta.url), 'utf8');

  assert.match(helper, /oldTemperature/);
  assert.match(helper, /newTemperature/);
  assert.match(helper, /oldEnterpriseId/);
  assert.match(helper, /newEnterpriseId/);
  assert.match(helper, /oldFunnelStatus/);
  assert.match(helper, /newFunnelStatus/);
  assert.match(repository, /'\{lastLeadClassificationAudit\}'/);
});
