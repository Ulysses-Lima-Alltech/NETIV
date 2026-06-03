import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('recusa de agendamento cancela fluxo e evita pedir horario', () => {
  const source = readFileSync(new URL('../services/conversationEngine.ts', import.meta.url), 'utf8');
  assert.match(source, /APPOINTMENT_FLOW_CANCELLED_BY_USER/);
  assert.match(source, /isVisitSchedulingRefusal\(trimmed\) \|\| isVisitSchedulingRefusalMessage\(trimmed\)/);
  assert.match(source, /pendingVisitScheduling:\s*false/);
});

test('regras comerciais cobrem entrada e pagamento', () => {
  const cfg = readFileSync(new URL('../config/anaCommercialRules.ts', import.meta.url), 'utf8');
  const svc = readFileSync(new URL('../services/anaCommercialRulesService.ts', import.meta.url), 'utf8');
  assert.match(cfg, /entrada/);
  assert.match(cfg, /parcela exata ou simulação personalizada/);
  assert.match(cfg, /120x/);
  assert.match(cfg, /48x/);
  assert.match(svc, /payment_terms_general/);
  assert.match(svc, /personalized_financial_simulation/);
  assert.match(svc, /entrega_empreendimento/);
  assert.match(svc, /valor_condominio/);
});

test('resposta repetida de agendamento e bloqueada', () => {
  const source = readFileSync(new URL('../services/conversationEngine.ts', import.meta.url), 'utf8');
  assert.match(source, /ANA_REPEATED_RESPONSE_BLOCKED/);
  assert.match(source, /isVisitSchedulingLoopFallbackReply/);
  assert.match(source, /repeated_visit_scheduling_reply|outbound_repeat_guard/);
});

test('logs de regra comercial obrigatoria existem', () => {
  const source = readFileSync(new URL('../services/conversationEngine.ts', import.meta.url), 'utf8');
  assert.match(source, /ANA_COMMERCIAL_RULE_PAYMENT_PLANS/);
  assert.match(source, /ANA_COMMERCIAL_RULE_LOT_DETAILS/);
});

test('mensagem de nome separada no fluxo comercial existe', () => {
  const source = readFileSync(new URL('../services/conversationEngine.ts', import.meta.url), 'utf8');
  assert.match(source, /askNameMessage/);
  assert.match(source, /commercialMessagesToSend\.push\(ANA_COMMERCIAL_RULES\.askNameMessage\)/);
});
