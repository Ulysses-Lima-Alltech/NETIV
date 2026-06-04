import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const engine = fs.readFileSync(new URL('../services/conversationEngine.ts', import.meta.url), 'utf8');
const visit = fs.readFileSync(new URL('../utils/anaDirectVisitScheduling.ts', import.meta.url), 'utf8');

test('resposta comercial do Evora sem pergunta recebe pergunta final segura', () => {
  assert.match(engine, /\[ANA_EVORA_COMMERCIAL_FINAL_QUESTION_GUARD\]/);
  assert.match(engine, /processedCommercialRuleMessages\.push\(safeFinalQuestion\)/);
  assert.match(engine, /buildEvoraSafeNextTopicQuestion\(safeGuardCurrentTopic\)/);
});

test('guarda de pergunta final cobre seguranca e demais topicos comerciais', () => {
  assert.match(engine, /effectiveCommercialRule\.ruleId === 'seguranca_portaria'\) return 'seguranca'/);
  assert.match(engine, /effectiveCommercialRule\.ruleId === 'areas_lazer'\) return 'lazer'/);
  assert.match(engine, /effectiveCommercialRule\.ruleId === 'localizacao_endereco'/);
  assert.match(engine, /effectiveCommercialRule\.ruleId === 'preco_valor_lote'/);
});

test('confirmacao sim apos posso confirmar sua visita vira agendamento confirmado', () => {
  assert.match(visit, /function assistantAskedVisitConfirmation/);
  assert.match(visit, /ackOnlyMessage && assistantAskedConfirmation/);
  assert.match(visit, /assistant_confirmation_ack_reconstructed/);
  assert.match(visit, /appointmentConfirmed/);
});

test('confirmacao reconstruida usa data e horario da ultima mensagem da Ana', () => {
  assert.match(visit, /parseDateMention\(input\.lastAssistantMessage \|\| '', referenceNow\)/);
  assert.match(visit, /parseTimeHmFromText\(input\.lastAssistantMessage \|\| ''/);
  assert.match(visit, /confirmReply\(assistantConfirmationDate\.label, assistantConfirmationTime\)/);
});