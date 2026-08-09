import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { handleVisitSchedulingDeterministically } from '../utils/anaDirectVisitScheduling.js';
import type { CommercialFlowState } from '../utils/commercialFlowState.js';
import { applyEvoraLocationGuard } from '../utils/anaEvoraCommercialGuards.js';

function readSource(tsRelativePath: string, jsRelativePath: string): string {
  try {
    return fs.readFileSync(new URL(tsRelativePath, import.meta.url), 'utf8');
  } catch {
    return fs.readFileSync(new URL(jsRelativePath, import.meta.url), 'utf8');
  }
}

const engineSource = readSource('../services/conversationEngine.ts', '../services/conversationEngine.js');
const webhookSource = readSource('../services/webhookProcessor.ts', '../services/webhookProcessor.js');
const evoraLocationAndMaterialSource = readSource('../utils/anaEvoraLocationAndMaterial.ts', '../utils/anaEvoraLocationAndMaterial.js');

const REF = new Date('2026-07-05T12:00:00-03:00');

function visitTurn(
  flowState: CommercialFlowState,
  userMessage: string,
  lastAssistantMessage = 'Perfeito. Para qual dia você prefere agendar a visita?'
) {
  return handleVisitSchedulingDeterministically({
    userMessage,
    flowState,
    lastAssistantMessage,
    enterpriseId: 10,
    customerName: 'Paula',
    customerPhone: '11999999999',
    referenceNow: REF,
  });
}

test('webhook resolve Evora antes de atalhos de agenda/engine', () => {
  assert.match(webhookSource, /ANA_ENTERPRISE_RESOLVE/);
  assert.match(webhookSource, /ANA_EVORA_DEFAULT_PHONE_NUMBER_ID\s*=\s*'1070497299485505'/);
  assert.match(webhookSource, /setConversationEnterpriseIdAndOrigin/);

  const resolveCall = webhookSource.indexOf('conv = await resolveAnaEnterpriseBeforeEngine');
  const fastSchedule = webhookSource.indexOf('const shouldFastScheduleAnaBeforeClassifier');
  assert.ok(resolveCall > -1, 'resolução determinística não foi chamada no webhook');
  assert.ok(fastSchedule > -1, 'atalho de schedule não encontrado');
  assert.ok(resolveCall < fastSchedule, 'Évora precisa ser resolvido antes do fast schedule');
});

test('guardrail factual do Evora remove Campinas e força localização correta', () => {
  const result = applyEvoraLocationGuard({
    conversationId: 1,
    enterpriseId: 10,
    enterpriseName: 'Residencial Évora',
    userMessage: 'onde fica o Évora?',
    answer: 'O Évora é um loteamento em Atibaia, na região de Campinas.',
  });

  assert.equal(result.changed, true);
  assert.equal(result.reason, 'campinas_region_leak_rewritten');
  assert.doesNotMatch(result.text, /Campinas/i);
  assert.match(result.text, /Pedreira\/Rio Abaixo/);
  assert.match(result.text, /Dom Pedro I/);
});

test('foto indisponivel nao promete envio', () => {
  assert.match(engineSource, /ANA_IMAGE_NOT_FOUND_REPLY/);
  assert.match(engineSource, /canClaimMaterialWasSent = mediaOutcome\.ok === true/);
  assert.match(engineSource, /textHasMaterialDeliveryClaim\(replyText\)/);
  assert.match(evoraLocationAndMaterialSource, /Ainda não encontrei essa foto cadastrada aqui/);
});

test('agenda preserva semana que vem, tarde, 15h e confirma exatamente ultimo candidato', () => {
  let state: CommercialFlowState = {};

  let decision = visitTurn(state, 'de tarde, umas 15h');
  assert.equal(decision.reason, 'time_or_period_without_date');
  state = decision.nextState;
  assert.equal(state.pendingVisitTime, '15:00');
  assert.equal(state.pendingVisitPeriod, 'tarde');

  decision = visitTurn(state, 'só posso semana que vem');
  state = decision.nextState;
  assert.equal(state.pendingVisitDateLabel, 'semana que vem');
  assert.equal(state.pendingVisitDate, null);

  decision = visitTurn(state, 'melhor na quarta');
  state = decision.nextState;
  assert.equal(decision.reason, 'ready_to_confirm_visit');
  assert.equal(state.pendingVisitDate, '2026-07-08');
  assert.equal(state.pendingVisitTime, '15:00');
  assert.equal(state.pendingAppointmentCandidate?.time, '15:00');
  assert.match(decision.reply ?? '', /15h/);

  decision = visitTurn(state, 'A TARDE umas 15');
  state = decision.nextState;
  assert.equal(decision.reason, 'ready_to_confirm_visit');
  assert.equal(state.pendingVisitTime, '15:00');
  assert.equal(state.pendingAppointmentCandidate?.time, '15:00');

  decision = visitTurn(state, 'quarta às 16');
  state = decision.nextState;
  assert.equal(decision.reason, 'ready_to_confirm_visit');
  assert.equal(state.pendingVisitTime, '16:00');
  assert.equal(state.pendingAppointmentCandidate?.time, '16:00');
  assert.match(decision.reply ?? '', /16h/);

  decision = visitTurn(state, 'sim', decision.reply ?? undefined);
  assert.equal(decision.reason, 'pending_appointment_candidate_accepted');
  assert.equal(decision.appointmentConfirmed, true);
  assert.equal(decision.appointmentDateYmd, '2026-07-08');
  assert.equal(decision.appointmentTimeHm, '16:00');
  assert.match(decision.reply ?? '', /16h/);
});
