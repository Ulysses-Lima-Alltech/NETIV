import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

test('inbox ativo exclui Carteira e arquivadas, exceto filtro explicito Carteira', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'repositories/conversationRepository.ts'), 'utf8');
  const listIndex = source.indexOf('export async function listConversationsWithPreview');
  const listSource = source.slice(listIndex, source.indexOf('export async function updateClassification'));

  assert.match(listSource, /explicitWalletStatus = explicitStatus === 'Carteira'/);
  assert.match(listSource, /COALESCE\(c\.classification, ''\) <> 'Carteira'/);
  assert.match(listSource, /c\.manual_closed_at IS NULL/);
  assert.match(listSource, /m\.deleted_at IS NULL AND m\.content ILIKE/);
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
