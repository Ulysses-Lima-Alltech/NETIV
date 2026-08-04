import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ANA_COMMERCIAL_RULES } from '../config/anaCommercialRules.js';
import {
  computeAnaFollowupAtUtc,
  getAnaFollowupDelayMinutes,
  isAnaFollowupForbiddenNightWindowSp,
} from '../utils/anaFollowupCadence.js';

test('commercial follow-up usa a cadencia oficial ancorada na ultima resposta da Ana', () => {
  const anchor = new Date('2026-06-10T12:00:00.000Z');

  const expectedOffsets = [
    5, 6, 7, 8, 9,
    69, 70, 71, 72, 73,
    313, 314, 315, 316, 317,
    617, 618, 619, 620, 621,
  ];

  for (const [idx, offset] of expectedOffsets.entries()) {
    const attemptIndex = idx + 1;
    assert.equal(getAnaFollowupDelayMinutes(attemptIndex), offset);
    assert.equal(
      computeAnaFollowupAtUtc({ anchor, attemptIndex }).toISOString(),
      new Date(anchor.getTime() + offset * 60_000).toISOString()
    );
  }

  assert.throws(() => getAnaFollowupDelayMinutes(0), RangeError);
  assert.throws(() => getAnaFollowupDelayMinutes(21), RangeError);
});

test('commercial follow-up nao envia entre 23:59 e 07:00 no fuso de Sao Paulo', () => {
  assert.equal(isAnaFollowupForbiddenNightWindowSp(new Date('2026-07-04T23:58:00.000-03:00').getTime()), false);
  assert.equal(isAnaFollowupForbiddenNightWindowSp(new Date('2026-07-04T23:59:00.000-03:00').getTime()), true);
  assert.equal(isAnaFollowupForbiddenNightWindowSp(new Date('2026-07-05T06:59:00.000-03:00').getTime()), true);
  assert.equal(isAnaFollowupForbiddenNightWindowSp(new Date('2026-07-05T07:00:00.000-03:00').getTime()), false);

  assert.equal(
    computeAnaFollowupAtUtc({
      anchor: new Date('2026-07-04T23:55:00.000-03:00'),
      attemptIndex: 1,
    }).toISOString(),
    new Date('2026-07-05T07:00:00.000-03:00').toISOString()
  );
});

test('lista comercial Evora nao tem ciclo vazio', () => {
  assert.ok(ANA_COMMERCIAL_RULES.followupWhileNoResponseMessages.length >= 1);
  assert.equal(
    ANA_COMMERCIAL_RULES.followupWhileNoResponseMessages.every((message) => message.trim().length > 0),
    true
  );
});

test('reengagement geral preserva bloqueios comerciais e logs essenciais', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'services/anaReengagementService.ts'), 'utf8');

  assert.match(source, /return 'handoff'/);
  assert.match(source, /return 'carteira'/);
  assert.match(source, /return 'assigned_broker'/);
  assert.match(source, /return 'manual_closed'/);
  assert.match(source, /reason: 'ai_disabled_or_blocked'/);
  assert.match(source, /reason: 'last_not_assistant'/);
  assert.match(source, /reason: 'not_due'/);
  assert.match(source, /reason: 'enterprise_id_inactive'/);
  assert.match(source, /ANA_FOLLOWUP_SENT/);
});

test('follow-up usa placeholders separados para ids int e bigint', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'services/anaReengagementService.ts'), 'utf8');

  assert.match(source, /reengagement_for_user_message_id = \$2::int/);
  assert.match(source, /ana_followup_for_user_message_id = \$7::bigint/);
  assert.match(source, /reengagement_for_user_message_id = \$1::int/);
  assert.match(source, /ana_followup_for_user_message_id = \$8::bigint/);
  assert.doesNotMatch(source, /ana_followup_for_user_message_id = \$1,/);
  assert.doesNotMatch(source, /ana_followup_for_user_message_id = \$2,/);
});

test('politica antiga de conversa ativa nao bloqueia follow-up geral', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'services/anaReengagementService.ts'), 'utf8');

  assert.doesNotMatch(source, /evaluateAnaReengagementPolicy/);
  assert.doesNotMatch(source, /active_conversation/);
  assert.doesNotMatch(source, /Math\.abs\(lastInbound/);
});

test('novo inbound reseta completamente o ciclo geral e cancela visita', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'repositories/conversationRepository.ts'), 'utf8');
  const resetIndex = source.indexOf('export async function applyInboundUserMessageResets');
  const resetSource = source.slice(resetIndex, source.indexOf('export async function setConversationPendingResolutionState'));

  assert.match(resetSource, /reengagement_count = 0/);
  assert.match(resetSource, /ana_followup_anchor_assistant_message_id = NULL/);
  assert.match(resetSource, /ana_followup_for_user_message_id = NULL/);
  assert.match(resetSource, /ana_followup_attempt_count = 0/);
  assert.match(resetSource, /ana_followup_next_at = NULL/);
  assert.match(
    resetSource,
    /ana_followup_status = CASE[\s\S]*WHEN classification = 'Carteira' OR handoff = true[\s\S]*THEN 'cancelled'[\s\S]*ELSE 'idle'/
  );
  assert.match(resetSource, /ANA_FOLLOWUP_RESET/);
  assert.match(resetSource, /reason: 'customer_replied'/);
});
