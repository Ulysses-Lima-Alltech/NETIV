import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('evora location guard define blocos e bloqueia lucas como acesso', () => {
  const source = readFileSync(new URL('../utils/anaEvoraCommercialGuards.ts', import.meta.url), 'utf8');
  assert.match(source, /Atibaia faz parte da região bragantina/);
  assert.match(source, /Fica na Região da Pedreira, no bairro do Rio Abaixo/);
  assert.match(source, /fácil acesso pela Rodovia Dom Pedro I/);
  assert.match(source, /hasLucasAsAccessLeak/);
  assert.match(source, /\[ANA_EVORA_LOCATION_GUARD\]/);
});

test('visit offer guard adiciona visita e evita repeticao', () => {
  const source = readFileSync(new URL('../utils/anaEvoraCommercialGuards.ts', import.meta.url), 'utf8');
  assert.match(source, /applyAnaVisitOfferGuard/);
  assert.match(source, /alreadyOfferedVisit/);
  assert.match(source, /\[ANA_VISIT_OFFER_GUARD\]/);
  assert.match(source, /Que tal você marcar uma visita \?/);
  assert.match(source, /commercialAnsweredQuestionsCount >= 2/);
  assert.match(source, /currentCountsAsAnsweredCommercialQuestion/);
  assert.match(source, /appendedVisitOfferMessages/);
  assert.match(source, /commercial_interest_after_two_answers/);
});

test('no repeat guard existe e registra log', () => {
  const source = readFileSync(new URL('../utils/anaEvoraCommercialGuards.ts', import.meta.url), 'utf8');
  assert.match(source, /applyAnaNoRepeatMessageGuard/);
  assert.match(source, /exact_duplicate_blocked|semantic_duplicate_blocked/);
  assert.match(source, /\[ANA_NO_REPEAT_MESSAGE_GUARD\]/);
});

test('conversation engine aplica guards antes do envio', () => {
  const source = readFileSync(new URL('../services/conversationEngine.ts', import.meta.url), 'utf8');
  assert.match(source, /applyEvoraLocationGuard/);
  assert.match(source, /applyAnaVisitOfferGuard/);
  assert.match(source, /applyAnaNoRepeatMessageGuard/);
  const idxLoc = source.indexOf('const evoraLocationGuardResult = applyEvoraLocationGuard');
  const idxVisit = source.indexOf('const visitOfferGuardResult = applyAnaVisitOfferGuard');
  const idxNoRepeat = source.indexOf('const noRepeatGuardResult = applyAnaNoRepeatMessageGuard');
  const idxTraceReady = source.indexOf("anaEngineTrace('final_reply_ready'");
  assert.ok(idxLoc > 0 && idxVisit > idxLoc && idxNoRepeat > idxVisit && idxTraceReady > idxNoRepeat);
});

