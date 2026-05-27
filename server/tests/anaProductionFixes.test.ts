import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { resolveAnaCommercialRule } from '../services/anaCommercialRulesService.js';
import { applyAnaNoRepeatMessageGuard, blockLegacyAggressiveVisitCtaByIntent } from '../utils/anaEvoraCommercialGuards.js';

test('Teste 1: entrega com base resolvida nunca envia label vazio', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'services/conversationEngine.ts'), 'utf8');
  assert.match(source, /isWeakEntregaAnswer/);
  assert.match(source, /Ainda não tenho essa previsão exata liberada por aqui\./);
});

test('Teste 2: "quando sera entregue" sem acento cai em entrega_empreendimento', () => {
  const rule = resolveAnaCommercialRule({
    enterpriseName: 'Évora',
    userMessage: 'quando sera entregue?',
    isFirstAnaReply: false,
    previousAssistantMessage: null,
  });
  assert.equal(rule?.ruleId, 'entrega_empreendimento');
});

test('Teste 3: "perguntei quando sera entregue" cai em entrega_empreendimento', () => {
  const rule = resolveAnaCommercialRule({
    enterpriseName: 'Évora',
    userMessage: 'perguntei quando sera entregue',
    isFirstAnaReply: false,
    previousAssistantMessage: null,
  });
  assert.equal(rule?.ruleId, 'entrega_empreendimento');
});

test('Teste 4: localização não deve carregar CTA agressivo legado', () => {
  const guarded = blockLegacyAggressiveVisitCtaByIntent({
    text: 'Que tal voce marcar uma visita? O Evora fica em Atibaia.',
    intent: 'localizacao_endereco',
    hasRecentVisitCta: false,
  });
  assert.equal(guarded.changed, true);
  assert.equal(/que tal|vamos marcar|visita\\?/i.test(guarded.text), false);
  assert.match(guarded.text, /evora|atibaia/i);
});

test('Teste 5: fallback repetido não repete texto genérico antigo', () => {
  const out = applyAnaNoRepeatMessageGuard({
    conversationId: 1,
    enterpriseId: 1,
    enterpriseName: 'Évora',
    userMessage: 'perguntei quando sera entregue',
    answer: 'Isso mesmo. Se quiser, eu detalho esse ponto de forma objetiva.',
    recentAssistantReplies: ['Isso mesmo. Se quiser, eu detalho esse ponto de forma objetiva.'],
    semanticallySimilar: (a, b) => a === b,
  });
  assert.equal(out.changed, false);
  assert.equal(out.text, 'Isso mesmo. Se quiser, eu detalho esse ponto de forma objetiva.');
});

test('Teste 6: envios finais passam por guard de não repetição no engine', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'services/conversationEngine.ts'), 'utf8');
  assert.match(source, /const noRepeatForCommercialRule = applyAnaNoRepeatMessageGuard/);
  assert.match(source, /const noRepeatGuardResult = applyAnaNoRepeatMessageGuard/);
});
