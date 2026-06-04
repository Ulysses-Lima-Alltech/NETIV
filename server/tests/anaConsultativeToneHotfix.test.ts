import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../services/conversationEngine.ts', import.meta.url), 'utf8');

test('Evora nao fica limitado a 3 linhas secas no modo conversacional', () => {
  assert.match(source, /Responda de forma natural, consultiva e menos seca/);
  assert.match(source, /Use 2 a 4 frases/);
  assert.match(source, /Pode separar em até 2 mensagens curtas/);
  assert.match(source, /Conecte o interesse do cliente ao Évora/);
});

test('diretiva comercial evita foco estreito e pergunta abstrata', () => {
  assert.match(source, /evite ficar preso em um único detalhe/);
  assert.match(source, /rotina, natureza, lazer, segurança, localização, família e visita/);
  assert.match(source, /Evite perguntas abstratas como "como voce imagina seu dia começando\?"/);
  assert.match(source, /perguntas concretas/);
});

test('seguranca canonica ganha lead-in humano sem fallback', () => {
  assert.match(source, /\[ANA_SECURITY_LIFESTYLE_LEAD_IN_APPLIED\]/);
  assert.match(source, /effectiveCommercialRule\.ruleId === 'seguranca_portaria'/);
  assert.match(source, /segurança não é só portaria/);
  assert.match(source, /tranquilidade para a família/);

  const idx = source.indexOf('[ANA_SECURITY_LIFESTYLE_LEAD_IN_APPLIED]');
  const around = source.slice(Math.max(0, idx - 900), idx + 900);

  assert.doesNotMatch(around, /generateChatCompletion/);
  assert.doesNotMatch(around, /token_budget_fallback/);
});