import { readServerSourceFile } from './helpers/serverSourceResolver.js';
import assert from 'node:assert/strict';
import test from 'node:test';

const source = readServerSourceFile('services/conversationEngine.js');

function sliceFunction(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `marker nao encontrado: ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.ok(end > start, `marker de fim nao encontrado apos inicio: ${endMarker}`);
  return source.slice(start, end);
}

test('kill switch e texto de fallback existem com defaults seguros', () => {
  assert.match(
    source,
    /const ANA_BLOCKED_TURN_FALLBACK_ENABLED =\s*String\(process\.env\.ANA_BLOCKED_TURN_FALLBACK_ENABLED \?\? 'true'\)\.trim\(\)\.toLowerCase\(\) !== 'false'/
  );
  assert.match(
    source,
    /export const ANA_BLOCKED_TURN_SAFETY_FALLBACK_REPLY =\s*['"]Vou confirmar isso rapidinho com o time e te retorno\.['"]/
  );
});

test('choke point unico: fallback é chamado 1x no finally do turno, depois do safe reply global', () => {
  assert.match(
    source,
    /await sendGlobalNoEnterpriseFinalSafeReply\(anaTurnAuditBlockedReason\);\s*\}\s*await sendAnaBlockedTurnSafetyFallback\(\);/
  );
  // A definição usa "= async (): Promise<void> =>", então só a chamada real
  // ("await sendAnaBlockedTurnSafetyFallback()") bate com esse padrão — precisa ser única.
  const callSites = source.match(/await sendAnaBlockedTurnSafetyFallback\(\)/g) ?? [];
  assert.equal(callSites.length, 1);
});

test('guardas de entrada: kill switch, outcome=blocked, sem resposta ainda, e sem hard block (handoff/carteira/manual_closed/etc.)', () => {
  const helper = sliceFunction(
    'const sendAnaBlockedTurnSafetyFallback = async',
    'const resolveCustomerNameOrPhoneForBrokerTemplate'
  );
  assert.match(helper, /if \(!ANA_BLOCKED_TURN_FALLBACK_ENABLED\) return;/);
  assert.match(helper, /if \(anaTurnAuditOutcome !== 'blocked'\) return;/);
  assert.match(helper, /if \(assistantReplyAttemptedOrSent\) return;/);
  assert.match(helper, /const silentExitContext = getAnaSilentExitContext\(\);/);
  assert.match(helper, /if \(silentExitContext\.hardBlockReason != null\) return;/);
});

test('envia 1 mensagem neutra via canal central e aciona corretor humano', () => {
  const helper = sliceFunction(
    'const sendAnaBlockedTurnSafetyFallback = async',
    'const resolveCustomerNameOrPhoneForBrokerTemplate'
  );
  assert.match(helper, /sendAnaOutboundMessages\(\{/);
  assert.match(helper, /text: ANA_BLOCKED_TURN_SAFETY_FALLBACK_REPLY/);
  assert.match(helper, /phase: 'ana_blocked_turn_safety_fallback'/);
  assert.match(helper, /assignConversationToNextBroker\(\{/);
  assert.match(helper, /await verifyAndRepairHandoffAfterBrokerAssignment\(assignment\);/);
  assert.match(helper, /sendBrokerPendingAttendanceTemplate\(\{/);
  assert.match(helper, /sendBrokerPendingAttendancePush\(\{/);
  assert.match(helper, /\[ANA_BLOCKED_TURN_SAFETY_FALLBACK\]/);
  assert.match(helper, /\[ANA_BLOCKED_TURN_SAFETY_FALLBACK_SENT\]/);
  assert.match(helper, /originalBlockedReason/);
});

test('marca assistantReplyAttemptedOrSent antes do envio (nunca dispara 2x no mesmo turno)', () => {
  const helper = sliceFunction(
    'const sendAnaBlockedTurnSafetyFallback = async',
    'const resolveCustomerNameOrPhoneForBrokerTemplate'
  );
  const guardIndex = helper.indexOf('if (assistantReplyAttemptedOrSent) return;');
  const markIndex = helper.indexOf('assistantReplyAttemptedOrSent = true;');
  const sendIndex = helper.indexOf('sendAnaOutboundMessages({');
  assert.ok(guardIndex >= 0 && markIndex > guardIndex && sendIndex > markIndex);
});

test('nao reintroduz retry automatico do LLM nem reengajamento proativo', () => {
  const helper = sliceFunction(
    'const sendAnaBlockedTurnSafetyFallback = async',
    'const resolveCustomerNameOrPhoneForBrokerTemplate'
  );
  assert.doesNotMatch(helper, /setTimeout|setInterval/);
  assert.doesNotMatch(helper, /generateChatCompletion|callQwen|invokeQwen|structured\?\.reply/);
  assert.doesNotMatch(helper, /RetryJob|retry_job|scheduleAnaRetry|enqueueAnaRetry/i);
  assert.doesNotMatch(helper, /reengagement|Reengagement/);
});

test('respeita ANA_AUTO_HANDOFF_CREATION_DISABLED (nao sobrescreve handoff por fora do helper existente)', () => {
  for (const match of source.matchAll(/assignConversationToNextBroker\(\{/g)) {
    const before = source.slice(Math.max(0, match.index - 2000), match.index);
    assert.match(before, /ANA_AUTO_HANDOFF_CREATION_DISABLED|!ANA_AUTO_HANDOFF_CREATION_DISABLED|shouldAssignBroker/);
  }
});
