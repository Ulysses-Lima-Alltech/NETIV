import { readServerSourceFile } from './helpers/serverSourceResolver.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveAnaGeneralFollowupStartDecision,
} from '../services/anaGeneralFollowupService.js';
import {
  ANA_GENERAL_FOLLOWUP_MAX_OVERDUE_MS,
  isAnaGeneralFollowupStaleDue,
} from '../services/anaReengagementService.js';

const baseConversation = {
  id: 15333,
  channel: 'whatsapp',
  conversation_type: 'CLIENT',
  handoff: false,
  classification: 'Novo',
  manual_closed_at: null,
  assigned_broker_id: null,
};

function withEnv<T>(env: Record<string, string | undefined>, fn: () => T): T {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(env)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('resgate geral arma apos resposta comercial normal da Ana aguardando cliente', () => {
  const assistantCreatedAt = new Date('2026-07-08T12:00:00.000Z');
  const decision = resolveAnaGeneralFollowupStartDecision({
    conversationId: 15333,
    enterpriseId: 7,
    assistantMessageId: 9002,
    assistantCreatedAt,
    lastUserMessageId: 9001,
    finalReplyText: 'Oi! O Evora e um loteamento fechado em Atibaia. Como posso te chamar?',
    commercialFlowState: {},
    sourcePhase: 'commercial_rules',
    conversation: baseConversation,
  });

  assert.equal(decision.eligible, true);
  assert.equal(decision.reason, 'awaiting_customer_reply');
  if (!decision.eligible) return;
  assert.equal(decision.nextFollowupAt.toISOString(), '2026-07-08T12:05:00.000Z');
});
test('startAnaGeneralFollowupIfEligible cria ciclo novo depois do cutover e rejeita antes', () => {
  withEnv({ ANA_GENERAL_FOLLOWUP_CUTOVER_AT: '2026-07-08T12:00:00.000Z' }, () => {
    const afterCutover = resolveAnaGeneralFollowupStartDecision({
      conversationId: 15333,
      enterpriseId: 7,
      assistantMessageId: 9002,
      assistantCreatedAt: new Date('2026-07-08T12:00:01.000Z'),
      lastUserMessageId: 9001,
      finalReplyText: 'Quer que eu te explique lazer ou seguranca?',
      commercialFlowState: {},
      sourcePhase: 'ana_main_reply',
      conversation: baseConversation,
    });
    assert.equal(afterCutover.eligible, true);

    const beforeCutover = resolveAnaGeneralFollowupStartDecision({
      conversationId: 15333,
      enterpriseId: 7,
      assistantMessageId: 9002,
      assistantCreatedAt: new Date('2026-07-08T11:59:59.000Z'),
      lastUserMessageId: 9001,
      finalReplyText: 'Quer que eu te explique lazer ou seguranca?',
      commercialFlowState: {},
      sourcePhase: 'ana_main_reply',
      conversation: baseConversation,
    });
    assert.equal(beforeCutover.eligible, false);
    assert.equal(beforeCutover.reason, 'before_cutover');
  });
});

test('start persiste os campos ana_followup_* ancorados na resposta e na ultima mensagem do cliente', () => {
  const source = readServerSourceFile('services/anaGeneralFollowupService.ts');
  const engine = readServerSourceFile('services/conversationEngine.ts');

  assert.match(engine, /startAnaGeneralFollowupIfEligible/);
  assert.match(engine, /startAnaGeneralFollowupAfterSuccessfulAnaSend/);
  assert.match(source, /ana_followup_status = 'active'/);
  assert.match(source, /ana_followup_anchor_assistant_message_id = \$2/);
  assert.match(source, /ana_followup_anchor_assistant_created_at = \$3/);
  assert.match(source, /ana_followup_for_user_message_id = \$4::bigint/);
  assert.match(source, /ana_followup_attempt_count = 0/);
  assert.match(source, /ana_followup_last_attempt_at = NULL/);
  assert.match(source, /ana_followup_last_sent_message_id = NULL/);
  assert.match(source, /ana_followup_cancel_reason = NULL/);
  assert.match(source, /ana_followup_next_at = \$5/);
  assert.match(source, /attemptIndex: 1/);
});

test('novo inbound do cliente cancela ciclo geral e limpa next_at', () => {
  const source = readServerSourceFile('repositories/conversationRepository.ts');
  const resetIndex = source.indexOf('export async function applyInboundUserMessageResets');
  const resetSource = source.slice(resetIndex, source.indexOf('export async function setConversationPendingResolutionState'));

  assert.match(resetSource, /ana_followup_anchor_assistant_message_id = NULL/);
  assert.match(resetSource, /ana_followup_for_user_message_id = NULL/);
  assert.match(resetSource, /ana_followup_attempt_count = 0/);
  assert.match(resetSource, /ana_followup_next_at = NULL/);
  assert.match(resetSource, /ana_followup_status = CASE[\s\S]*WHEN classification = 'Carteira' OR handoff = true/);
  assert.match(resetSource, /lower\(trim\(COALESCE\(classification, ''\)\)\) = 'handoff'/);
  assert.match(resetSource, /THEN 'cancelled'[\s\S]*ELSE 'idle'/);
  assert.match(resetSource, /\[ANA_GENERAL_FOLLOWUP\] cancelled/);
  assert.match(resetSource, /reason: 'customer_replied'/);
});

test('visita confirmada cancela ciclo geral', () => {
  const decision = resolveAnaGeneralFollowupStartDecision({
    conversationId: 15333,
    enterpriseId: 7,
    assistantMessageId: 9002,
    assistantCreatedAt: new Date('2026-07-08T12:00:00.000Z'),
    lastUserMessageId: 9001,
    finalReplyText: 'Perfeito, sua visita ficou confirmada.',
    commercialFlowState: {
      pendingVisitScheduling: false,
      visitScheduling: {
        active: false,
        offered: true,
        accepted: true,
        requestedDateText: 'amanha',
        requestedTimeText: '14h',
        normalizedDate: '2026-07-09',
        normalizedTime: '14:00',
        nameCollected: true,
        customerName: 'Ana',
        status: 'scheduled',
      },
    },
    sourcePhase: 'deterministic_visit_scheduling',
    conversation: baseConversation,
  });

  assert.equal(decision.eligible, false);
  assert.equal(decision.reason, 'visit_scheduled');
  assert.equal(decision.cancelExisting, true);
});

test('handoff, manual_closed_at e Carteira nao armam ciclo geral', () => {
  const cases = [
    {
      name: 'handoff',
      conversation: { ...baseConversation, handoff: true, classification: 'Handoff' },
      reason: 'handoff',
    },
    {
      name: 'manual_closed',
      conversation: { ...baseConversation, manual_closed_at: new Date('2026-07-08T12:00:00.000Z') },
      reason: 'manual_closed',
    },
    {
      name: 'carteira',
      conversation: { ...baseConversation, classification: 'Carteira' },
      reason: 'carteira',
    },
  ];

  for (const item of cases) {
    const decision = resolveAnaGeneralFollowupStartDecision({
      conversationId: 15333,
      enterpriseId: 7,
      assistantMessageId: 9002,
      assistantCreatedAt: new Date('2026-07-08T12:00:00.000Z'),
      lastUserMessageId: 9001,
      finalReplyText: 'Quer que eu te explique valores ou localizacao?',
      commercialFlowState: {},
      sourcePhase: 'ana_main_reply',
      conversation: item.conversation,
    });

    assert.equal(decision.eligible, false, item.name);
    assert.equal(decision.reason, item.reason);
    assert.equal(decision.cancelExisting, true);
  }
});

test('mensagens internas, midia pos-envio e confirmacoes tecnicas nao armam ciclo', () => {
  const internal = resolveAnaGeneralFollowupStartDecision({
    conversationId: 15333,
    enterpriseId: 7,
    assistantMessageId: 9002,
    assistantCreatedAt: new Date('2026-07-08T12:00:00.000Z'),
    lastUserMessageId: 9001,
    finalReplyText: 'Quer que eu te explique valores ou localizacao?',
    commercialFlowState: {},
    sourcePhase: 'ana_main_reply',
    conversation: { ...baseConversation, conversation_type: 'CORRETOR' },
  });
  assert.equal(internal.eligible, false);
  assert.equal(internal.reason, 'internal_conversation');

  const media = resolveAnaGeneralFollowupStartDecision({
    conversationId: 15333,
    enterpriseId: 7,
    assistantMessageId: 9002,
    assistantCreatedAt: new Date('2026-07-08T12:00:00.000Z'),
    lastUserMessageId: 9001,
    finalReplyText: 'Enviei as imagens do empreendimento.',
    commercialFlowState: {},
    sourcePhase: 'ana_image_material_model_followup',
    conversation: baseConversation,
  });
  assert.equal(media.eligible, false);
  assert.equal(media.reason, 'source_phase_not_eligible');

  const technical = resolveAnaGeneralFollowupStartDecision({
    conversationId: 15333,
    enterpriseId: 7,
    assistantMessageId: 9002,
    assistantCreatedAt: new Date('2026-07-08T12:00:00.000Z'),
    lastUserMessageId: 9001,
    finalReplyText: 'Tudo certo por aqui.',
    commercialFlowState: {},
    sourcePhase: 'ana_main_reply',
    conversation: baseConversation,
  });
  assert.equal(technical.eligible, false);
  assert.equal(technical.reason, 'reply_not_waiting_customer');
});

test('scan do worker ignora backlog idle e exige ciclo active ancorado', () => {
  const source = readServerSourceFile('services/anaReengagementService.ts');
  const scanIndex = source.indexOf('export async function processAnaReengagementScan');
  const scanSource = source.slice(scanIndex, source.indexOf('async function trySendReengagementForConversation'));

  assert.match(scanSource, /ana_followup_status = 'active'/);
  assert.doesNotMatch(scanSource, /COALESCE\(ana_followup_status, 'idle'\)/);
  assert.match(scanSource, /ana_followup_anchor_assistant_message_id IS NOT NULL/);
  assert.match(scanSource, /ana_followup_anchor_assistant_created_at IS NOT NULL/);
  assert.match(scanSource, /ana_followup_next_at IS NOT NULL/);
  assert.match(scanSource, /ana_followup_next_at <= NOW\(\)/);
});

test('scan respeita cutover opcional por anchor_assistant_created_at', () => {
  const source = readServerSourceFile('services/anaReengagementService.ts');
  const startService = readServerSourceFile('services/anaGeneralFollowupService.ts');
  const scanIndex = source.indexOf('export async function processAnaReengagementScan');
  const scanSource = source.slice(scanIndex, source.indexOf('async function trySendReengagementForConversation'));

  assert.match(startService, /ANA_GENERAL_FOLLOWUP_CUTOVER_AT/);
  assert.match(scanSource, /getAnaGeneralFollowupCutoverAtFromEnv/);
  assert.match(scanSource, /ana_followup_anchor_assistant_created_at >= \$2/);
  assert.match(scanSource, /cutoverAt/);
});

test('next_at vencido ha mais de 15 minutos cancela como stale_due_followup e nao envia', () => {
  assert.equal(ANA_GENERAL_FOLLOWUP_MAX_OVERDUE_MS, 15 * 60_000);
  const now = new Date('2026-07-08T12:30:00.000Z');
  assert.equal(
    isAnaGeneralFollowupStaleDue({
      nextAt: new Date(now.getTime() - ANA_GENERAL_FOLLOWUP_MAX_OVERDUE_MS - 1),
      now,
    }),
    true
  );
  assert.equal(
    isAnaGeneralFollowupStaleDue({
      nextAt: new Date(now.getTime() - ANA_GENERAL_FOLLOWUP_MAX_OVERDUE_MS + 1),
      now,
    }),
    false
  );

  const source = readServerSourceFile('services/anaReengagementService.ts');
  const staleIndex = source.indexOf("reason: 'stale_due_followup'");
  const logIndex = source.indexOf('[ANA_GENERAL_FOLLOWUP] stale_due_cancelled');
  const sendIndex = source.indexOf('const sendRes = await sendAnaTextMessageWithQuota');

  assert.ok(staleIndex > -1);
  assert.ok(logIndex > staleIndex);
  assert.ok(sendIndex > logIndex);
  assert.ok(staleIndex < sendIndex);
});

test('logs obrigatorios do ciclo geral estao presentes', () => {
  const service = readServerSourceFile('services/anaGeneralFollowupService.ts');
  const worker = readServerSourceFile('services/anaReengagementService.ts');
  const repo = readServerSourceFile('repositories/conversationRepository.ts');

  assert.match(service, /\[ANA_GENERAL_FOLLOWUP\] started_or_kept_active/);
  assert.match(service, /\[ANA_GENERAL_FOLLOWUP\] not_eligible/);
  assert.match(`${service}\n${worker}\n${repo}`, /\[ANA_GENERAL_FOLLOWUP\] cancelled/);
  assert.match(worker, /\[ANA_GENERAL_FOLLOWUP\] sent/);
  assert.match(`${service}\n${worker}`, /\[ANA_GENERAL_FOLLOWUP\] blocked_quiet_hours/);
});
