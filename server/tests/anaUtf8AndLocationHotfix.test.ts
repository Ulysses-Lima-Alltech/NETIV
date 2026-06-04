import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

test('webhookProcessor nao envia quebra de linha literal no fluxo de nome', () => {
  const source = fs.readFileSync(new URL('../services/webhookProcessor.ts', import.meta.url), 'utf8');

  assert.match(source, /join\('\\n\\n'\)/);
  assert.doesNotMatch(source, /join\('\\\\n\\\\n'\)/);
});

test('webhookProcessor usa unicode escapes corretos no fluxo de nome', () => {
  const source = fs.readFileSync(new URL('../services/webhookProcessor.ts', import.meta.url), 'utf8');

  assert.match(source, /r\\u00E1pidas/);
  assert.match(source, /\\u00C9vora/);
  assert.match(source, /Voc\\u00EA est\\u00E1/);

  assert.equal(source.includes('r\uFFFDpidas'), false);
  assert.equal(source.includes('\uFFFDvora'), false);
  assert.equal(source.includes('Voc\uFFFD'), false);
});

test('webhookProcessor responde aprofundamento de localizacao antes do fallback', () => {
  const source = fs.readFileSync(new URL('../services/webhookProcessor.ts', import.meta.url), 'utf8');

  const locationIndex = source.indexOf('ANA_WEBHOOK_LOCATION_DEEP_DIVE_REPLY_SENT');
  const fallbackIndex = source.indexOf('ANA_WEBHOOK_FAST_SCHEDULE_BEFORE_CLASSIFIER');

  assert.ok(locationIndex > -1, 'resposta de localização não encontrada');
  assert.ok(fallbackIndex > -1, 'fast schedule não encontrado');
  assert.ok(locationIndex < fallbackIndex, 'localização precisa ser tratada antes do fast schedule/fallback');

  assert.match(source, /regi\\u00E3o bragantina/);
  assert.match(source, /Rodovia Dom Pedro I/);
});

test('conversationEngine nao vaza unicode literal duplicado no no-info', () => {
  const source = fs.readFileSync(new URL('../services/conversationEngine.ts', import.meta.url), 'utf8');

  assert.match(source, /confirma\\u00E7\\u00E3o atualizada/);
  assert.doesNotMatch(source, /confirma\\\\u00E7\\\\u00E3o/);
});
