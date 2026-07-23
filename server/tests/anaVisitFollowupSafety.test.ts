import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoSource = () =>
  readFileSync(path.resolve(process.cwd(), 'repositories/anaVisitFollowupJobRepository.ts'), 'utf8');
const serviceSource = () =>
  readFileSync(path.resolve(process.cwd(), 'services/anaVisitFollowupService.ts'), 'utf8');
const messageRepoSource = () =>
  readFileSync(path.resolve(process.cwd(), 'repositories/messageRepository.ts'), 'utf8');
const conversationRepoSource = () =>
  readFileSync(path.resolve(process.cwd(), 'repositories/conversationRepository.ts'), 'utf8');

test('job cancelado ou inbound antes do envio bloqueia send e nao chama advance', () => {
  const source = serviceSource();
  const revalidationIndex = source.indexOf('const readiness = await revalidateAnaVisitFollowupJobForSend');
  const sendIndex = source.indexOf('const send = await sendAnaTextMessageWithQuota');
  const advanceIndex = source.indexOf('const advanced = await advanceAnaVisitFollowupJob', sendIndex);

  assert.ok(revalidationIndex > -1, 'worker precisa revalidar antes do envio');
  assert.ok(sendIndex > -1, 'worker precisa manter envio explicito');
  assert.ok(revalidationIndex < sendIndex, 'revalidacao final deve ocorrer antes do envio Meta');
  assert.ok(sendIndex < advanceIndex, 'advance deve ocorrer somente depois do envio');
  assert.match(source, /markAnaVisitFollowupAttemptSkipped\([\s\S]*final_revalidation_/);
  assert.match(source, /final_revalidation_blocked_send/);
});

test('advance defensivo nao ressuscita job cancelado', () => {
  const source = repoSource();
  const advanceIndex = source.indexOf('export async function advanceAnaVisitFollowupJob');
  const advanceSource = source.slice(advanceIndex, source.indexOf('export async function markAnaVisitFollowupJobCancelled'));

  assert.match(advanceSource, /AND status = 'processing'/);
  assert.match(advanceSource, /AND locked_by = \$\d+/);
  assert.match(advanceSource, /return \(result\.rowCount \?\? 0\) > 0/);
  assert.doesNotMatch(advanceSource, /WHERE id = \$1`/);
});

test('inbound do cliente e serializado com o envio final da regua', () => {
  const messageSource = messageRepoSource();
  const repo = repoSource();
  const conversationSource = conversationRepoSource();

  assert.match(repo, /SELECT pg_advisory_xact_lock\(\$1::bigint\)/);
  assert.doesNotMatch(repo, /pg_advisory_lock\(/);
  assert.doesNotMatch(repo, /pg_advisory_unlock/);
  assert.match(repo, /ROLLBACK/);
  assert.match(messageSource, /if \(role === 'user'\) \{/);
  assert.match(messageSource, /withAnaVisitFollowupConversationLock\(conversationId/);
  assert.match(repo, /has_user_after_anchor/);
  assert.match(repo, /WHEN has_user_after_anchor THEN 'customer_replied'/);
  assert.match(conversationSource, /applyInboundUserMessageResets/);
  assert.match(conversationSource, /reason: 'customer_replied'/);
});

test('conversation_type nao CLIENT e fechamento manual cancelam imediatamente', () => {
  const source = conversationRepoSource();
  const typeIndex = source.indexOf('export async function updateConversationType');
  const closeIndex = source.indexOf('export async function closeConversationManual');
  const typeSource = source.slice(typeIndex, closeIndex);
  const closeSource = source.slice(closeIndex, source.indexOf('export async function reopenConversationManual'));

  assert.match(typeSource, /withAnaVisitFollowupConversationLock\(conversationId/);
  assert.match(typeSource, /cancelActiveAnaVisitFollowupJobs\(/);
  assert.match(typeSource, /reason: 'non_client_conversation'/);
  assert.match(closeSource, /withAnaVisitFollowupConversationLock\(conversationId/);
  assert.match(closeSource, /cancelActiveAnaVisitFollowupJobs\(/);
  assert.match(closeSource, /reason: 'manual_closed'/);
});

test('revalidacao final confere automacao, visita, inbound e lock do worker', () => {
  const source = repoSource();
  const revalidationIndex = source.indexOf('export async function revalidateAnaVisitFollowupJobForSend');
  const revalidationSource = source.slice(revalidationIndex);

  assert.match(revalidationSource, /status <> 'processing'/);
  assert.match(revalidationSource, /locked_by IS DISTINCT FROM \$2/);
  assert.match(revalidationSource, /conv_manual_closed_at IS NOT NULL/);
  assert.match(revalidationSource, /COALESCE\(conv_conversation_type, 'CLIENT'\) <> 'CLIENT'/);
  assert.match(revalidationSource, /lower\(trim\(COALESCE\(conv_classification, ''\)\)\) = 'handoff'/);
  assert.match(revalidationSource, /visitScheduling,status/);
  assert.match(revalidationSource, /visit_flow_inactive/);
  assert.match(revalidationSource, /has_open_appointment/);
  assert.match(revalidationSource, /has_user_after_anchor/);
});
