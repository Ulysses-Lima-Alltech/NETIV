import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ANA_COMMERCIAL_RULES } from '../config/anaCommercialRules.js';
import { computeCommercialFollowupEligibleAtUtc } from '../utils/anaReengagementSchedule.js';
import { getAnaFollowupDelayMinutes } from '../utils/anaFollowupCadence.js';

test('commercial follow-up usa a cadencia oficial ancorada na ultima resposta da Ana', () => {
  const anchor = new Date('2026-06-10T12:00:00.000Z');

  assert.equal(getAnaFollowupDelayMinutes(1), 1);
  assert.equal(computeCommercialFollowupEligibleAtUtc(anchor, 0)?.toISOString(), '2026-06-10T12:01:00.000Z');
  assert.equal(computeCommercialFollowupEligibleAtUtc(anchor, 4)?.toISOString(), '2026-06-10T12:05:00.000Z');
  assert.equal(computeCommercialFollowupEligibleAtUtc(anchor, 5)?.toISOString(), '2026-06-10T13:05:00.000Z');
  assert.equal(computeCommercialFollowupEligibleAtUtc(anchor, 8)?.toISOString(), '2026-06-10T15:06:00.000Z');
  assert.equal(computeCommercialFollowupEligibleAtUtc(anchor, 13)?.toISOString(), '2026-06-10T17:10:00.000Z');
  assert.equal(computeCommercialFollowupEligibleAtUtc(anchor, -1), null);
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
  assert.match(resetSource, /ana_followup_status = 'idle'/);
  assert.match(resetSource, /ANA_FOLLOWUP_RESET/);
  assert.match(resetSource, /reason: 'customer_replied'/);
});
