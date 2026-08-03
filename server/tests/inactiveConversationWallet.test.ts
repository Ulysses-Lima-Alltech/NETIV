import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  AUTO_WALLET_INACTIVE_REASON,
  isConversationEligibleForAutoWallet,
} from '../services/inactiveConversationWalletService.js';

test('conversa com ultima mensagem ha 6 dias fica elegivel para Carteira automatica', () => {
  const now = new Date('2026-07-01T12:00:00.000Z');

  assert.equal(
    isConversationEligibleForAutoWallet({
      classification: 'Novo',
      lastMessageAt: new Date('2026-06-25T11:59:59.000Z'),
      updatedAt: new Date('2026-07-01T11:00:00.000Z'),
      createdAt: new Date('2026-06-20T12:00:00.000Z'),
      now,
    }),
    true
  );
});

test('conversa com ultima mensagem ha 4 dias nao muda', () => {
  const now = new Date('2026-07-01T12:00:00.000Z');

  assert.equal(
    isConversationEligibleForAutoWallet({
      classification: 'Qualificado',
      lastMessageAt: new Date('2026-06-27T12:00:00.000Z'),
      updatedAt: new Date('2026-06-27T12:00:00.000Z'),
      createdAt: new Date('2026-06-20T12:00:00.000Z'),
      now,
    }),
    false
  );
});

test('conversa ja Carteira nao entra no lote idempotente', () => {
  const now = new Date('2026-07-01T12:00:00.000Z');

  assert.equal(
    isConversationEligibleForAutoWallet({
      classification: 'Carteira',
      lastMessageAt: new Date('2026-06-01T12:00:00.000Z'),
      updatedAt: new Date('2026-06-01T12:00:00.000Z'),
      createdAt: new Date('2026-06-01T12:00:00.000Z'),
      now,
    }),
    false
  );
});

test('inbox ativo exclui Carteira e arquivadas, exceto filtro explicito Carteira', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'repositories/conversationRepository.ts'), 'utf8');
  const listIndex = source.indexOf('export async function listConversationsWithPreview');
  const listSource = source.slice(listIndex, source.indexOf('export async function updateClassification'));

  assert.match(listSource, /explicitWalletStatus = explicitStatus === 'Carteira'/);
  assert.match(listSource, /COALESCE\(c\.classification, ''\) <> 'Carteira'/);
  assert.match(listSource, /c\.manual_closed_at IS NULL/);
  assert.match(listSource, /m\.deleted_at IS NULL AND m\.content ILIKE/);
});

test('apply automatico move para Carteira, arquiva e cancela workers pendentes', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'services/inactiveConversationWalletService.ts'), 'utf8');

  assert.match(source, /MAX\(m\.created_at\)/);
  assert.match(source, /m\.deleted_at IS NULL/);
  assert.match(source, /classification = 'Carteira'/);
  assert.match(source, /manual_closed_at = COALESCE\(c\.manual_closed_at, NOW\(\)\)/);
  assert.match(source, /manual_closed_reason = COALESCE\(NULLIF\(c\.manual_closed_reason, ''\), \$2\)/);
  assert.match(source, /ana_followup_status = 'cancelled'/);
  assert.match(source, /ana_followup_next_at = NULL/);
  assert.match(source, /ana_followup_cancel_reason = \$2/);
  assert.match(source, /UPDATE ana_visit_followup_jobs/);
  assert.match(source, /UPDATE ana_retry_jobs/);
  assert.match(source, new RegExp(AUTO_WALLET_INACTIVE_REASON));
});

test('scan de reengagement seleciona somente ciclo geral ativo e revalida Carteira/handoff antes do envio', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'services/anaReengagementService.ts'), 'utf8');
  const scanIndex = source.indexOf('export async function processAnaReengagementScan');
  const scanSource = source.slice(scanIndex, source.indexOf('async function trySendReengagementForConversation'));
  const blockedReasonIndex = source.indexOf('function getAutomationBlockedReason');
  const blockedReasonSource = source.slice(blockedReasonIndex, source.indexOf('async function cancelAndLogFollowup'));
  const finalValidationIndex = source.indexOf('async function sendReengagementAfterFinalValidation');
  const finalValidationSource = source.slice(finalValidationIndex);

  assert.match(scanSource, /ana_followup_status = 'active'/);
  assert.match(scanSource, /ana_followup_anchor_assistant_message_id IS NOT NULL/);
  assert.match(scanSource, /ana_followup_anchor_assistant_created_at IS NOT NULL/);
  assert.match(scanSource, /ana_followup_next_at IS NOT NULL/);
  assert.match(scanSource, /ana_followup_next_at <= NOW\(\)/);
  assert.match(scanSource, /COALESCE\(handoff, false\) = false/);
  assert.match(scanSource, /lower\(trim\(COALESCE\(classification, ''\)\)\) <> 'handoff'/);
  assert.match(scanSource, /lower\(trim\(COALESCE\(classification, ''\)\)\) <> 'carteira'/);
  assert.match(scanSource, /ana_followup_anchor_assistant_created_at >= \$2/);
  assert.doesNotMatch(scanSource, /ana_followup_next_at IS NULL OR/);
  assert.doesNotMatch(scanSource, /COALESCE\(ana_followup_status, 'idle'\)/);

  assert.match(blockedReasonSource, /isAnaAutomationBlockedByHandoff\(conv\)/);
  assert.match(blockedReasonSource, /String\(conv\.classification \?\? ''\)\.trim\(\)\.toLowerCase\(\) === 'carteira'/);
  assert.match(finalValidationSource, /SELECT \* FROM conversations WHERE id = \$1 FOR UPDATE/);
  const blockedIndex = finalValidationSource.indexOf('const blockedReason = getAutomationBlockedReason(locked)');
  const cancelIndex = finalValidationSource.indexOf('await cancelAndLogFollowup({', blockedIndex);
  const sendIndex = finalValidationSource.indexOf('const sendRes = await sendAnaTextMessageWithQuota');
  assert.ok(blockedIndex >= 0 && cancelIndex > blockedIndex && sendIndex > cancelIndex);
});

test('workers da Ana bloqueiam Carteira e arquivadas antes de enviar', () => {
  const engine = readFileSync(path.resolve(process.cwd(), 'services/conversationEngine.ts'), 'utf8');
  const retry = readFileSync(path.resolve(process.cwd(), 'services/anaRetryWorkerService.ts'), 'utf8');
  const visitService = readFileSync(path.resolve(process.cwd(), 'services/anaVisitFollowupService.ts'), 'utf8');
  const visitRepo = readFileSync(path.resolve(process.cwd(), 'repositories/anaVisitFollowupJobRepository.ts'), 'utf8');

  assert.match(engine, /effectiveConv\.classification === 'Carteira' \|\| effectiveConv\.manual_closed_at != null/);
  assert.match(engine, /engine_blocked_inactive_wallet_or_closed/);
  assert.match(retry, /conv\.classification === 'Carteira'/);
  assert.match(retry, /conv\.manual_closed_at != null/);
  assert.match(retry, /skipped_automation_blocked/);
  assert.match(visitService, /conv\.classification === 'Carteira'/);
  assert.match(visitRepo, /conv_classification = 'Carteira'/);
});

test('deferred handoff worker nao processa Carteira e nao gera loop de log', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'repositories/conversationRepository.ts'), 'utf8');
  const start = source.indexOf('export async function processDueDeferredHandoffs');
  const body = source.slice(start, source.indexOf('export async function applyHandoffAfterAppointmentConfirmation'));

  assert.match(body, /return 0/);
  assert.doesNotMatch(body, /UPDATE conversations/);
  assert.doesNotMatch(body, /logAutoHandoffBlocked/);
});

test('realtime do Inbox remove Carteira e arquivadas quando filtro ativo nao pede Carteira', () => {
  const source = readFileSync(path.resolve(process.cwd(), '..', 'src/pages/InboxPage.tsx'), 'utf8');

  assert.match(source, /shouldShowConversationInCurrentList/);
  assert.match(source, /classification === 'Carteira' \|\| conversation\.manualClosedAt != null/);
  assert.match(source, /prev\.filter\(\(c\) => c\.id !== incoming\.id\)/);
  assert.match(source, /prev\.filter\(\(c\) => c\.id !== mapped\.id\)/);
  assert.match(source, /filter\(\(row\) => shouldShowConversationInCurrentList\(row\)\)/);
});
