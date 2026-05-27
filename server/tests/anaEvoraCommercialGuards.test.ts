import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

test('evora location guard remove apenas leak especifico sem forcar resposta fixa', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'utils/anaEvoraCommercialGuards.ts'), 'utf8');
  assert.match(source, /hasLucasAsAccessLeak/);
  assert.match(source, /\[ANA_EVORA_LOCATION_GUARD\]/);
  assert.match(source, /lucas_garces_access_sentence_removed/);
  assert.equal(source.includes('access_intent_forced_canonical_location'), false);
});

test('visit offer guard adiciona visita e evita repeticao', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'utils/anaEvoraCommercialGuards.ts'), 'utf8');
  assert.match(source, /applyAnaVisitOfferGuard/);
  assert.match(source, /alreadyOfferedVisit/);
  assert.match(source, /\[ANA_VISIT_OFFER_GUARD\]/);
  assert.match(source, /Se fizer sentido para você, posso te ajudar a agendar uma visita\./);
  assert.match(source, /commercialAnsweredQuestionsCount >= 2/);
  assert.match(source, /currentCountsAsAnsweredCommercialQuestion/);
  assert.match(source, /appendedVisitOfferMessages/);
  assert.match(source, /commercial_interest_after_two_answers/);
});

test('bloqueio de CTA agressivo legado existe', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'utils/anaEvoraCommercialGuards.ts'), 'utf8');
  assert.match(source, /containsLegacyAggressiveVisitCta/);
  assert.match(source, /blockLegacyAggressiveVisitCtaByIntent/);
  assert.match(source, /aproveita pra conhecer nosso stand/i);
});

test('no repeat guard existe e registra log', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'utils/anaEvoraCommercialGuards.ts'), 'utf8');
  assert.match(source, /applyAnaNoRepeatMessageGuard/);
  assert.match(source, /exact_duplicate_detected_no_rewrite|semantic_duplicate_detected_no_rewrite/);
  assert.match(source, /\[ANA_NO_REPEAT_MESSAGE_GUARD\]/);
});

test('conversation engine aplica guards antes do envio', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'services/conversationEngine.ts'), 'utf8');
  assert.match(source, /applyEvoraLocationGuard/);
  assert.match(source, /applyAnaVisitOfferGuard/);
  assert.match(source, /applyAnaNoRepeatMessageGuard/);
  const idxLoc = source.indexOf('const evoraLocationGuardResult = applyEvoraLocationGuard');
  const idxVisit = source.indexOf('const visitOfferGuardResult = applyAnaVisitOfferGuard');
  const idxNoRepeat = source.indexOf('const noRepeatGuardResult = applyAnaNoRepeatMessageGuard');
  const idxTraceReady = source.indexOf("anaEngineTrace('final_reply_ready'");
  assert.ok(idxLoc > 0 && idxVisit > idxLoc && idxNoRepeat > idxVisit && idxTraceReady > idxNoRepeat);
});
