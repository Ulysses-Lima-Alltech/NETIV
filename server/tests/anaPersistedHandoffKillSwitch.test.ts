import assert from 'node:assert/strict';
import test from 'node:test';
import {
  __setAnaEntryConversationLoaderForTest,
  __setAnaEmergencyHandoffTransportForTest,
  handleIncomingMessage,
} from '../services/conversationEngine.js';
import {
  __setAnaHandoffConversationLoaderForTest,
  sendAnaLocalMediaToWhatsAppWithQuota,
  sendAnaTextMessageWithQuota,
} from '../services/anaOutboundQuotaService.js';
import { cancelAnaPendingAutomationForHandoff } from '../repositories/anaHandoffAutomationRepository.js';
import {
  isAnaAutomationBlockedByHandoff,
  logAnaAutomationBlockedByHandoff,
  normalizeAnaHandoffClassification,
} from '../utils/anaAutomationEligibility.js';
import { readServerSourceFile } from './helpers/serverSourceResolver.js';

function withEnv(values: Record<string, string | undefined>, fn: () => Promise<void>): Promise<void> {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
  return fn().finally(() => {
    for (const [key, value] of previous) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

test('politica canonica bloqueia boolean, status normalizado e nao usa corretor isolado', () => {
  assert.equal(isAnaAutomationBlockedByHandoff({ handoff: true, classification: null }), true);
  assert.equal(isAnaAutomationBlockedByHandoff({ handoff: false, classification: 'Handoff' }), true);
  assert.equal(isAnaAutomationBlockedByHandoff({ handoff: false, classification: ' handoff ' }), true);
  assert.equal(isAnaAutomationBlockedByHandoff({ handoff: false, classification: 'HANDOFF' }), true);
  assert.equal(isAnaAutomationBlockedByHandoff({ handoff: false, classification: 'Novo', assigned_broker_id: 7 }), false);
  assert.equal(normalizeAnaHandoffClassification(' HANDOFF '), 'handoff');
  assert.equal(
    isAnaAutomationBlockedByHandoff({ handoff: true, classification: 'Novo', enterprise_id: 12 } as never),
    true
  );
  assert.equal(
    isAnaAutomationBlockedByHandoff({ handoff: false, classification: ' HANDOFF ', enterprise_id: 1 } as never),
    true
  );
});

test('log canonico inclui contactId e somente metadados permitidos', () => {
  const entries: unknown[][] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => entries.push(args);
  try {
    logAnaAutomationBlockedByHandoff(
      { id: 77, contact_id: 88, handoff: true, classification: 'Handoff', assigned_broker_id: 9 },
      {
        conversationId: 77,
        automationType: 'retry',
        blockedAt: 'worker_start',
        source: 'test',
        messageId: 'wamid.input',
      }
    );
  } finally {
    console.log = originalLog;
  }
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.[0], '[ANA_JOB_CANCELLED_HANDOFF]');
  assert.deepEqual(entries[0]?.[1], {
    conversationId: 77,
    contactId: 88,
    automationType: 'retry',
    blockedAt: 'worker_start',
    currentMode: 'HANDOFF',
    currentStatus: 'Handoff',
    funnelStatus: 'Handoff',
    messageId: 'wamid.input',
    handoff: true,
    classification: 'Handoff',
    assignedBrokerId: 9,
    reason: 'HANDOFF_BLOCKS_ANA_AUTOMATION',
    source: 'test',
  });
});

test('engine respeita handoff persistido mesmo com ANA_HANDOFF_DISABLED=true', async () => {
  await withEnv({ ANA_HANDOFF_DISABLED: 'true', ANA_EMERGENCY_HANDOFF: 'false' }, async () => {
    let automaticSendCalls = 0;
    let fetchCalls = 0;
    const restoreLoader = __setAnaEntryConversationLoaderForTest(async () => ({
      id: 9123,
      handoff: true,
      classification: 'Novo',
      assigned_broker_id: null,
    } as never));
    const restoreTransport = __setAnaEmergencyHandoffTransportForTest({
      sendTextMessage: async () => {
        automaticSendCalls += 1;
        return { success: true, metaMessageId: 'unexpected' };
      },
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      throw new Error('IA/Meta nao deve ser chamada em HANDOFF');
    }) as typeof fetch;
    try {
      await handleIncomingMessage({
        conversationId: 9123,
        userMessage: 'oi',
        toPhoneNumber: '5511999999999',
      });
    } finally {
      globalThis.fetch = originalFetch;
      restoreTransport();
      restoreLoader();
    }
    assert.equal(automaticSendCalls, 0);
    assert.equal(fetchCalls, 0);
  });
});

test('guard final bloqueia corrida quando conversa muda para HANDOFF antes do envio', async () => {
  const restoreLoader = __setAnaHandoffConversationLoaderForTest(async () => ({
    id: 8123,
    handoff: false,
    classification: ' HANDOFF ',
    assigned_broker_id: null,
  } as never));
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    throw new Error('Meta nao deve ser chamada');
  }) as typeof fetch;
  try {
    const result = await sendAnaTextMessageWithQuota({
      conversationId: 8123,
      to: '5511999999999',
      text: 'resposta que ficou obsoleta',
      phase: 'ana_main_reply',
    });
    assert.equal(result.success, false);
    assert.equal(result.error, 'handoff_active');
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    restoreLoader();
  }
});

test('guard final bloqueia midia automatica antes de ler arquivo ou chamar Meta', async () => {
  const restoreLoader = __setAnaHandoffConversationLoaderForTest(async () => ({
    id: 8124,
    contact_id: 9124,
    handoff: true,
    classification: 'Novo',
    assigned_broker_id: null,
  } as never));
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    throw new Error('Meta nao deve ser chamada');
  }) as typeof fetch;
  try {
    const result = await sendAnaLocalMediaToWhatsAppWithQuota({
      conversationId: 8124,
      to: '5511999999999',
      filePath: 'arquivo-que-nao-deve-ser-lido.pdf',
      filename: 'material.pdf',
      mimeFromDb: 'application/pdf',
      phase: 'ana_media_first',
    });
    assert.equal(result.success, false);
    assert.equal(result.error, 'handoff_active');
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    restoreLoader();
  }
});

test('conversa normal continua enviando com flag antiga ativa', async () => {
  await withEnv(
    {
      ANA_HANDOFF_DISABLED: 'true',
      ANA_DEV_DISABLE_WHATSAPP_SEND: 'true',
      ANA_OUTBOUND_DISABLED: 'false',
      ANA_AUTOMATION_DISABLED: 'false',
      ANA_EMERGENCY_HANDOFF: 'false',
    },
    async () => {
      const restoreLoader = __setAnaHandoffConversationLoaderForTest(async () => ({
        id: 7123,
        handoff: false,
        classification: 'Novo',
        assigned_broker_id: 99,
      } as never));
      try {
        const result = await sendAnaTextMessageWithQuota({
          conversationId: 7123,
          to: '5511999999999',
          text: 'mensagem normal',
          phase: 'ana_main_reply',
        });
        assert.equal(result.success, true);
      } finally {
        restoreLoader();
      }
    }
  );
});

test('webhook persiste e publica inbound antes de bloquear texto e nao texto', () => {
  const source = readServerSourceFile('services/webhookProcessor.ts');
  const textPersisted = source.indexOf("await insertMessage(conv.id, 'user', text, mid)");
  const nonTextPersisted = source.indexOf("await insertMessage(conv.id, 'user', getNonTextInboxContent(msg), mid)");
  const nonTextGuard = source.indexOf("blockedAt: 'inbound_entry'", nonTextPersisted);
  const textGuard = source.indexOf("blockedAt: 'inbound_entry'", textPersisted);
  const enterpriseResolution = source.indexOf('conv = await resolveAnaEnterpriseBeforeEngine', textGuard);
  const debounce = source.indexOf('scheduleWhatsAppAiAfterUserMessage', textGuard);
  assert.ok(nonTextPersisted >= 0 && nonTextGuard > nonTextPersisted);
  assert.ok(textPersisted >= 0 && textGuard > textPersisted);
  assert.ok(enterpriseResolution > textGuard);
  assert.ok(debounce > textGuard);

  const messageRepository = readServerSourceFile('repositories/messageRepository.ts');
  const insertStart = messageRepository.indexOf('async function insertMessageUnlocked');
  const insertSource = messageRepository.slice(insertStart, messageRepository.indexOf('export async function getMessageCreatedAtById'));
  assert.match(insertSource, /publishMessageCreated\(/);
  assert.match(insertSource, /publishConversationUpdated\(/);
});

test('retry e workers encerram HANDOFF sem reagendar e usam o guard final comum', () => {
  const retry = readServerSourceFile('services/anaRetryWorkerService.ts');
  const beforeReschedule = retry.indexOf("blockedAt: 'before_enqueue'", retry.indexOf('isRetryableLlmError'));
  const nonRetryable = retry.indexOf('markAnaRetryJobFailedNonRetryable', beforeReschedule);
  const reschedule = retry.indexOf('rescheduleAnaRetryJob({', beforeReschedule);
  assert.ok(beforeReschedule >= 0 && nonRetryable > beforeReschedule && reschedule > nonRetryable);

  for (const file of [
    'services/anaReengagementService.ts',
    'services/anaVisitFollowupService.ts',
    'services/anaGeneralFollowupService.ts',
  ]) {
    assert.match(readServerSourceFile(file), /utils\/anaAutomationEligibility\.js/);
    assert.match(readServerSourceFile(file), /isAnaAutomationBlockedByHandoff/);
  }

  const engine = readServerSourceFile('services/conversationEngine.ts');
  assert.match(engine, /phase: 'ana_pending_assistant_continuation'/);
  assert.match(engine, /sendAnaTextMessageWithQuota as sendTextMessage/);
});

test('transicao para HANDOFF invalida estados e jobs automaticos sem apagar historico', () => {
  const cleanup = readServerSourceFile('repositories/anaHandoffAutomationRepository.ts');
  for (const key of [
    'pendingAssistantContinuation',
    'pending_action',
    'pending_material_type',
    'pendingVisitScheduling',
    'pendingAppointmentCandidate',
    'visitScheduling',
  ]) {
    assert.match(cleanup, new RegExp(`'${key}'`));
  }
  assert.match(cleanup, /ana_followup_status = 'cancelled'/);
  assert.match(cleanup, /ana_followup_next_at = NULL/);
  assert.match(cleanup, /UPDATE ana_retry_jobs[\s\S]*status = 'failed_non_retryable'[\s\S]*status IN \('pending', 'processing'\)/);
  assert.match(cleanup, /UPDATE ana_visit_followup_jobs[\s\S]*status = 'cancelled'[\s\S]*status IN \('active', 'processing'\)/);
  assert.doesNotMatch(cleanup, /DELETE FROM messages|UPDATE messages/);

  for (const file of [
    'repositories/conversationRepository.ts',
    'services/brokerAssignmentService.ts',
    'services/mobileConversationsService.ts',
  ]) {
    assert.match(readServerSourceFile(file), /cancelAnaPendingAutomationForHandoff/);
  }
});

test('limpeza de HANDOFF participa da transacao recebida e cancela os dois tipos de job', async () => {
  const statements: string[] = [];
  const fakeClient = {
    query: async (statement: string) => {
      statements.push(statement);
      if (statement.includes('UPDATE conversations')) return { rowCount: 1, rows: [] };
      if (statement.includes('UPDATE ana_retry_jobs')) return { rowCount: 2, rows: [] };
      if (statement.includes('UPDATE ana_visit_followup_jobs')) return { rowCount: 1, rows: [] };
      throw new Error(`SQL inesperado: ${statement}`);
    },
    release: () => undefined,
  };
  const originalLog = console.log;
  console.log = () => undefined;
  try {
    const result = await cancelAnaPendingAutomationForHandoff({
      conversationId: 123,
      source: 'test_transaction',
      client: fakeClient as never,
    });
    assert.deepEqual(result, {
      conversationUpdated: true,
      retryJobsCancelled: 2,
      visitFollowupJobsCancelled: 1,
    });
  } finally {
    console.log = originalLog;
  }
  assert.equal(statements.length, 3);
  assert.equal(statements.some((statement) => /BEGIN|COMMIT|ROLLBACK/.test(statement)), false);
});

test('criacao de retry, visita e continuacao possui guarda atomica persistida', () => {
  for (const file of [
    'repositories/anaRetryJobRepository.ts',
    'repositories/anaVisitFollowupJobRepository.ts',
  ]) {
    const source = readServerSourceFile(file);
    assert.match(source, /COALESCE\(c\.handoff, false\) = false/);
    assert.match(source, /lower\(trim\(COALESCE\(c\.classification, ''\)\)\) <> 'handoff'/);
  }
  const conversationRepository = readServerSourceFile('repositories/conversationRepository.ts');
  const anaUpdateStart = conversationRepository.indexOf('export async function applyAnaConversationUpdate');
  const mergeStart = conversationRepository.indexOf('export async function mergeConversationCommercialFlowState');
  const anaUpdateSource = conversationRepository.slice(anaUpdateStart, mergeStart);
  assert.match(anaUpdateSource, /COALESCE\(handoff, false\) = false/);
  assert.match(anaUpdateSource, /lower\(trim\(COALESCE\(classification, ''\)\)\) <> 'handoff'/);
  const mergeEnd = conversationRepository.indexOf('export async function scheduleDeferredHandoffAfterAppointment');
  const mergeSource = conversationRepository.slice(mergeStart, mergeEnd);
  assert.match(mergeSource, /COALESCE\(handoff, false\) = false/);
  assert.match(mergeSource, /lower\(trim\(COALESCE\(classification, ''\)\)\) <> 'handoff'/);
});

test('utilitario de elegibilidade central e limpeza SQL auditavel existem', () => {
  const eligibility = readServerSourceFile('utils/anaAutomationEligibility.ts');
  assert.match(eligibility, /isAnaAutomationBlocked/);
  assert.match(eligibility, /isAnaAutomationBlockedByHandoff/);

  const cleanup = readServerSourceFile('scripts/cancel-pending-ana-jobs-for-handoff.sql');
  assert.match(cleanup, /WITH handoff_conversations AS/);
  assert.match(cleanup, /SELECT \* FROM retry_jobs/);
  assert.match(cleanup, /UPDATE ana_retry_jobs/);
  assert.match(cleanup, /UPDATE ana_visit_followup_jobs/);
  assert.match(cleanup, /UPDATE conversations/);
  assert.doesNotMatch(cleanup, /DELETE FROM/);
});

test('env antiga nao mascara mais estado persistido e envio manual nao usa wrapper da Ana', () => {
  const engine = readServerSourceFile('services/conversationEngine.ts');
  assert.doesNotMatch(engine, /ANA_HANDOFF_DISABLED_IGNORED/);
  assert.doesNotMatch(engine, /handoff:\s*false,\s*classification:/s);
  assert.match(engine, /const ANA_AUTO_HANDOFF_CREATION_DISABLED/);

  const route = readServerSourceFile('routes/whatsapp.ts');
  const manualRoute = route.slice(route.indexOf("router.post('/conversations/:id/send'"));
  assert.match(manualRoute, /await sendTextMessage\(to, message\)/);
  assert.doesNotMatch(manualRoute, /sendAnaTextMessageWithQuota/);

  const mobile = readServerSourceFile('services/mobileConversationsService.ts');
  assert.match(mobile, /await sendTextMessage\(destinationPhone, normalizedText\)/);
  assert.doesNotMatch(mobile, /sendAnaTextMessageWithQuota/);
});

test('batch permite template de operador em HANDOFF e preserva HANDOFF no roteamento posterior', () => {
  const source = readServerSourceFile('services/whatsappBatchTemplateService.ts');
  const existingConversationLookup = source.indexOf('existingConversationResult = await query');
  const effectiveMode = source.indexOf('const effectivePostSendMode', existingConversationLookup);
  const send = source.indexOf('await sendTemplateMessage(params.candidate.phoneNormalized');
  const routing = source.indexOf('await applyBatchConversationRouting', send);
  assert.ok(existingConversationLookup >= 0 && effectiveMode > existingConversationLookup && send > effectiveMode && routing > send);
  assert.match(source, /const existingConversationInHandoff = isAnaAutomationBlockedByHandoff\(existingConversation\)/);
  assert.match(source, /existingConversationInHandoff\s*\?\s*'HANDOFF'\s*:\s*params\.postSendMode/);
  assert.match(source, /WHATSAPP_BATCH_OPERATOR_SEND_HANDOFF_PRESERVED/);
  assert.match(source, /requestedPostSendMode: params\.postSendMode/);
  assert.match(source, /effectivePostSendMode: 'HANDOFF'/);
  assert.match(source, /reason: 'OPERATOR_SEND_ALLOWED_HANDOFF_PRESERVED'/);
  assert.match(source, /deliveryKind: 'operator_requested_initial_batch'/);
  assert.match(source, /WHATSAPP_BATCH_INITIAL_TEMPLATE_HANDOFF_ALLOWED/);
  assert.doesNotMatch(source, /Conversa em HANDOFF; somente o template inicial/);
  assert.doesNotMatch(source, /automationType: 'batch_template_non_handoff'/);
  const handoffBranch = source.slice(source.indexOf('if (existingConversationInHandoff)'), send);
  assert.doesNotMatch(handoffBranch, /status: 'blocked'/);
  const routingCall = source.slice(routing, source.indexOf('});', routing) + 3);
  assert.match(routingCall, /postSendMode: effectivePostSendMode/);
  assert.match(source, /handoff:\s*params\.postSendMode === 'HANDOFF'/);
  assert.match(source, /source = params\.sourceKeyPrefix\.startsWith\('scheduled_batch:'\)/);
});
