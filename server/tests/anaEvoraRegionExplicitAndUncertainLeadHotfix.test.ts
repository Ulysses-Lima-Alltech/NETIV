import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const engine = fs.readFileSync(new URL('../services/conversationEngine.ts', import.meta.url), 'utf8');
const lead = fs.readFileSync(new URL('../utils/anaLeadQualificationPolicy.ts', import.meta.url), 'utf8');

test('pedido explicito de regiao sobrescreve regra herdada de lotes valores lazer ou seguranca', () => {
  assert.match(engine, /\[ANA_EVORA_EXPLICIT_REGION_OVERRIDE_COMMERCIAL_RULE\]/);
  assert.match(engine, /evoraCommercialExplicitRegionRequest/);
  assert.match(engine, /evoraCommercialRuleConflictsWithExplicitRegion/);
  assert.match(engine, /quantidade_lotes_info_gap/);
  assert.match(engine, /formas_pagamento/);
  assert.match(engine, /areas_lazer/);
  assert.match(engine, /seguranca_portaria/);
});

test('override de regiao nao deixa safe-next-topic usar ruleId antigo de lotes', () => {
  assert.match(engine, /let evoraCommercialRegionOverrideApplied = false/);
  assert.match(engine, /evoraCommercialRegionOverrideApplied = true/);
  assert.match(engine, /!evoraCommercialRegionOverrideApplied/);
});

test('resposta de regiao explicita fala de Pedreira Rio Abaixo Atibaia e Dom Pedro', () => {
  assert.match(engine, /Pedreira\/Rio Abaixo/);
  assert.match(engine, /Atibaia/);
  assert.match(engine, /Rodovia Dom Pedro I/);
  assert.match(engine, /50 minutos de São Paulo/);
});

test('lead indeciso como to pensando ainda vira pesquisa e nao reparo seco', () => {
  assert.match(lead, /to pensando/);
  assert.match(lead, /estou pensando/);
  assert.match(lead, /pensando ainda/);
  assert.match(lead, /return 'pesquisa'/);
  assert.match(lead, /Sem problema\. Você pode conhecer com calma/);
});

test('confirmacao curta ambigua pede escolha em vez de repetir tema', () => {
  assert.match(engine, /\[ANA_EVORA_SHORT_CHOICE_DISAMBIGUATION_GUARD\]/);
  assert.match(engine, /Você prefere que eu te explique sobre segurança ou sobre localização\?/);
  assert.match(engine, /Você prefere que eu fale dos espaços para família, esportes ou convivência\?/);
});