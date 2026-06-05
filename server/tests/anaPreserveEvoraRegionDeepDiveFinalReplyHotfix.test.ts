import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const engine = fs.readFileSync(new URL('../services/conversationEngine.ts', import.meta.url), 'utf8');

test('fala mais da regiao nao pode usar followup generico do ultimo eixo ofertado', () => {
  assert.match(engine, /const evoraExplicitRegionDeepDiveThisTurn =/);
  assert.match(engine, /regiao\|regi\\u00e3o\|bairro\|pedreira\|rio abaixo\|atibaia/);
  assert.match(engine, /!isRegionDeepDiveResolved && !evoraExplicitRegionDeepDiveThisTurn/);
});

test('region deep dive bloqueia canonical generico de ultimo eixo', () => {
  assert.match(engine, /isGenericInterestFollowup\(trimmed\) && \(isRegionDeepDiveResolved \|\| evoraExplicitRegionDeepDiveThisTurn\)/);
  assert.match(engine, /\[ANA_LOCATION_CANONICAL_BLOCKED_BY_REGION_DEEP_DIVE\]/);
});

test('resposta final de regiao e preservada se pos-processamento contaminar com lazer', () => {
  assert.match(engine, /\[ANA_EVORA_REGION_DEEP_DIVE_FINAL_REPLY_PRESERVED\]/);
  assert.match(engine, /evoraReplyLooksLikeLeisureAxis/);
  assert.match(engine, /evoraRegionTextHasLocationSignal/);
  assert.match(engine, /finalAxisGuardText/);
  assert.match(engine, /finalEvidenceGuard\.text/);
});

test('pergunta final em region deep dive e append only, sem reescrever corpo', () => {
  assert.match(engine, /\[ANA_EVORA_FINAL_QUESTION_APPENDED_ONLY\]/);
  assert.match(engine, /append_only_no_rewrite/);
  assert.match(engine, /Quer que eu te explique também sobre segurança ou os tamanhos dos lotes\?/);
});

test('pagamento continua sem IGPM', () => {
  assert.doesNotMatch(engine, /48x \+ IGPM/);
  assert.doesNotMatch(engine, /120x com juros \+ IGPM/);
});