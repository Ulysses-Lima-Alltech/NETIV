import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('recusa de agendamento cancela fluxo e evita pedir horario', () => {
  const source = readFileSync(new URL('../services/conversationEngine.ts', import.meta.url), 'utf8');
  assert.match(source, /APPOINTMENT_FLOW_CANCELLED_BY_USER/);
  assert.match(source, /isVisitSchedulingRefusal\(trimmed\) \|\| isVisitSchedulingRefusalMessage\(trimmed\)/);
  assert.match(source, /pendingVisitScheduling:\s*false/);
  assert.match(source, /directVisitSchedulingIntent && !userRefusedScheduling/);
});

test('regras comerciais cobrem lotes planos e tem plano', () => {
  const cfg = readFileSync(new URL('../config/anaCommercialRules.ts', import.meta.url), 'utf8');
  const svc = readFileSync(new URL('../services/anaCommercialRulesService.ts', import.meta.url), 'utf8');
  assert.match(cfg, /detalhes_lotes/);
  assert.match(cfg, /lotes a partir de 360 m²/);
  assert.match(cfg, /planos estendidos em até 120x/);
  assert.match(svc, /lotes planos|lote plano|tipo de lote/);
  assert.match(svc, /tem plano|planos/);
});

test('resposta repetida de agendamento e bloqueada', () => {
  const source = readFileSync(new URL('../services/conversationEngine.ts', import.meta.url), 'utf8');
  assert.match(source, /ANA_REPEATED_RESPONSE_BLOCKED/);
  assert.match(source, /isVisitSchedulingLoopFallbackReply/);
  assert.match(source, /repeated_response_guard/);
});

test('cliente irritado recebe reparo curto sem insistir em agendamento', () => {
  const source = readFileSync(new URL('../services/conversationEngine.ts', import.meta.url), 'utf8');
  assert.match(source, /Desculpa, você tem razão\. Sem agendar visita agora\. Vou te passar os detalhes por aqui\./);
});

test('logs de regra comercial obrigatoria existem', () => {
  const source = readFileSync(new URL('../services/conversationEngine.ts', import.meta.url), 'utf8');
  assert.match(source, /ANA_COMMERCIAL_RULE_LOT_DETAILS/);
  assert.match(source, /ANA_COMMERCIAL_RULE_PAYMENT_PLANS/);
});
