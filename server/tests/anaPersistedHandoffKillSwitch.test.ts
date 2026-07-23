import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  isAnaAutomationBlockedByHandoff,
  normalizeAnaHandoffClassification,
} from '../utils/anaAutomationEligibility.js';
import {
  __setAnaOutboundConversationLoaderForTest,
  sendAnaTextMessageWithQuota,
} from '../services/anaOutboundQuotaService.js';

const readServerSource = (relativePath: string) =>
  readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');

test('politica central identifica Handoff persistido por flag e classificacao normalizada', () => {
  assert.equal(isAnaAutomationBlockedByHandoff({ handoff: true, classification: 'Novo' }), true);
  assert.equal(isAnaAutomationBlockedByHandoff({ handoff: false, classification: 'Handoff' }), true);
  assert.equal(isAnaAutomationBlockedByHandoff({ handoff: false, classification: '  hAnDoFf  ' }), true);
  assert.equal(normalizeAnaHandoffClassification('  Handoff  '), 'handoff');
});

test('assigned_broker_id sozinho nao representa Handoff', () => {
  assert.equal(
    isAnaAutomationBlockedByHandoff({
      handoff: false,
      classification: 'Novo',
      assigned_broker_id: 123,
    }),
    false
  );
});

test('barreira final de texto automatico retorna handoff_active/423 e nao chama Meta', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls++;
    throw new Error('Meta nao deveria ser chamada em Handoff');
  }) as typeof fetch;
  __setAnaOutboundConversationLoaderForTest(async () => ({
    id: 10,
    channel: 'whatsapp',
    external_contact_id: '5511999999999',
    contact_phone: '5511999999999',
    customer_name: null,
    enterprise_id: null,
    classification: ' Handoff ',
    lead_temperature: null,
    handoff: false,
    meta_phone_number_id: null,
    last_message_at: null,
    created_at: new Date(),
    updated_at: new Date(),
  }));

  try {
    const result = await sendAnaTextMessageWithQuota({
      conversationId: 10,
      to: '5511999999999',
      text: 'teste',
      phase: 'ana_test_handoff_guard',
    });
    assert.equal(result.success, false);
    assert.equal(result.error, 'handoff_active');
    assert.equal(result.code, 423);
    assert.equal(fetchCalls, 0);
  } finally {
    __setAnaOutboundConversationLoaderForTest(null);
    globalThis.fetch = originalFetch;
  }
});

test('ANA_HANDOFF_DISABLED nao mascara Handoff persistido', () => {
  const engine = readServerSource('services/conversationEngine.ts');
  assert.match(engine, /ANA_HANDOFF_DISABLED/);
  assert.match(engine, /isAnaAutomationBlockedByHandoff\(entryConversation\)/);
  assert.match(engine, /isAnaAutomationBlockedByHandoff\(effectiveConv\)/);
  assert.doesNotMatch(engine, /ANA_HANDOFF_DISABLED_IGNORED/);
});

test('webhook salva inbound antes de bloquear classificador debounce IA e jobs', () => {
  const source = readServerSource('services/webhookProcessor.ts');
  const insertIndex = source.indexOf("await insertMessage(conv.id, 'user', text, mid)");
  const guardIndex = source.indexOf('await shouldBlockAnaWebhookAutomation({', insertIndex);
  const classifierIndex = source.indexOf('classifyLeadConversation({', guardIndex);
  const scheduleIndex = source.indexOf('scheduleWhatsAppAiAfterUserMessage', guardIndex);
  assert.ok(insertIndex >= 0);
  assert.ok(guardIndex > insertIndex);
  assert.ok(classifierIndex > guardIndex);
  assert.ok(scheduleIndex > guardIndex);
});

test('engine bloqueia na entrada e antes da IA', () => {
  const source = readServerSource('services/conversationEngine.ts');
  const entryIndex = source.indexOf('isAnaAutomationBlockedByHandoff(entryConversation)');
  const emergencyIndex = source.indexOf('isAnaEmergencyHandoffEnabled()', entryIndex);
  const finalIndex = source.indexOf('isAnaAutomationBlockedByHandoff(effectiveConv)');
  assert.ok(entryIndex >= 0);
  assert.ok(emergencyIndex > entryIndex);
  assert.ok(finalIndex > entryIndex);
});

test('scheduler e repositories nao criam jobs quando Handoff aparece em corrida', () => {
  const scheduler = readServerSource('services/anaRetrySchedulerService.ts');
  const retryRepo = readServerSource('repositories/anaRetryJobRepository.ts');
  const visitRepo = readServerSource('repositories/anaVisitFollowupJobRepository.ts');
  assert.match(scheduler, /blockedAt: 'before_enqueue'/);
  assert.match(scheduler, /ana_retry_scheduler_atomic_guard/);
  assert.match(retryRepo, /COALESCE\(c\.handoff, false\) = false/);
  assert.match(retryRepo, /lower\(trim\(COALESCE\(c\.classification, ''\)\)\) <> 'handoff'/);
  assert.match(visitRepo, /COALESCE\(c\.handoff, false\) = false/);
  assert.match(visitRepo, /lower\(trim\(COALESCE\(c\.classification, ''\)\)\) <> 'handoff'/);
});

test('workers cancelam Handoff e nao reagendam', () => {
  const retryWorker = readServerSource('services/anaRetryWorkerService.ts');
  const visitWorker = readServerSource('services/anaVisitFollowupService.ts');
  assert.match(retryWorker, /blockedAt: 'worker_start'/);
  assert.match(retryWorker, /blockedAt: 'before_reschedule'/);
  assert.match(retryWorker, /markAnaRetryJobFailedNonRetryable\(\{[\s\S]*errorMessage: 'handoff'/);
  assert.match(visitWorker, /blockedAt: 'worker_start'/);
  assert.match(visitWorker, /markAnaVisitFollowupJobCancelled\(\{[\s\S]*reason: 'handoff'/);
});

test('follow-up de visita trata corrida handoff_active como skipped e cancelled terminal', () => {
  const source = readServerSource('services/anaVisitFollowupService.ts');
  const guardIndex = source.indexOf("send.error === 'handoff_active' || send.code === 423");
  const genericIndex = source.indexOf('markAnaVisitFollowupAttemptFailed', guardIndex);
  const guardSource = source.slice(guardIndex, genericIndex);
  assert.ok(guardIndex >= 0);
  assert.match(guardSource, /getConversationById\(job\.conversation_id\)/);
  assert.match(guardSource, /isAnaAutomationBlockedByHandoff\(latestConversation\)/);
  assert.match(guardSource, /markAnaVisitFollowupAttemptSkipped\(\{[\s\S]*reason: 'handoff'/);
  assert.match(guardSource, /markAnaVisitFollowupJobCancelled\(\{[\s\S]*reason: 'handoff'/);
});

test('codigo 423 sem Handoff segue tratamento generico de erro', () => {
  const source = readServerSource('services/anaVisitFollowupService.ts');
  const handoffGuardIndex = source.indexOf("send.error === 'handoff_active' || send.code === 423");
  const genericIndex = source.indexOf('if (!send.success || !send.metaMessageId)', handoffGuardIndex);
  const genericSource = source.slice(genericIndex, source.indexOf('const inserted = await insertMessage', genericIndex));
  assert.ok(handoffGuardIndex >= 0);
  assert.ok(genericIndex > handoffGuardIndex);
  assert.match(genericSource, /markAnaVisitFollowupAttemptFailed/);
  assert.match(genericSource, /markAnaVisitFollowupJobFailed/);
});

test('transicao para Handoff cancela jobs e ciclo ana_followup', () => {
  const repo = readServerSource('repositories/anaHandoffAutomationRepository.ts');
  const conversation = readServerSource('repositories/conversationRepository.ts');
  assert.match(repo, /ana_retry_jobs/);
  assert.match(repo, /ana_visit_followup_jobs/);
  assert.match(repo, /ana_followup_status = 'cancelled'/);
  assert.match(repo, /ANA_PENDING_JOBS_CANCELLED_ON_HANDOFF/);
  assert.match(conversation, /cancelAnaPendingAutomationForHandoff\(\{/);
});

test('template manual e permitido e preserva Handoff', () => {
  const source = readServerSource('services/whatsappBatchTemplateService.ts');
  assert.match(source, /const conversationInHandoff = isAnaAutomationBlockedByHandoff\(conversation\)/);
  assert.match(source, /const effectivePostSendMode = conversationInHandoff \? 'HANDOFF' : params\.postSendMode/);
  assert.match(source, /WHATSAPP_BATCH_OPERATOR_SEND_HANDOFF_PRESERVED/);
  assert.match(source, /postSendMode: effectivePostSendMode/);
});
