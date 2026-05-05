import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  ANA_OUTBOUND_QUOTA_EXCEEDED_REASON,
  evaluateAnaOutboundQuota,
} from '../services/anaOutboundQuotaService.js';
import {
  ANA_HUMAN_ATTENDANCE_POLICY,
  buildAnaSystemPrompt,
} from '../services/anaAgentService.js';
import { applyAnaCommercialSingleAxisGuard } from '../utils/anaCommercialAxisGuard.js';
import { pickMaterialUnavailableNeutralReply } from '../utils/anaMaterialReply.js';
import { applyOperationalFactGuard } from '../utils/anaOperationalFactGuard.js';
import {
  evaluateAnaEmptyFallbackGuard,
  evaluateAnaOutboundText,
} from '../utils/anaReplyFinalize.js';
import { resolveAnaOpenAIModel } from '../utils/resolveAnaOpenAIModel.js';

test('cota permite Ana quando inbound_count=1 e ana_outbound_count=0', () => {
  const decision = evaluateAnaOutboundQuota({
    inboundCount: 1,
    anaOutboundCount: 0,
    isAutomaticAna: true,
  });

  assert.equal(decision.allowed, true);
  assert.equal(decision.reason, null);
});

test('cota bloqueia Ana quando inbound_count=1 e ana_outbound_count=1', () => {
  const decision = evaluateAnaOutboundQuota({
    inboundCount: 1,
    anaOutboundCount: 1,
    isAutomaticAna: true,
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, ANA_OUTBOUND_QUOTA_EXCEEDED_REASON);
});

test('cota permite Ana quando inbound_count=2 e ana_outbound_count=1', () => {
  const decision = evaluateAnaOutboundQuota({
    inboundCount: 2,
    anaOutboundCount: 1,
    isAutomaticAna: true,
  });

  assert.equal(decision.allowed, true);
  assert.equal(decision.reason, null);
});

test('cota bloqueia Ana quando inbound_count=2 e ana_outbound_count=2', () => {
  const decision = evaluateAnaOutboundQuota({
    inboundCount: 2,
    anaOutboundCount: 2,
    isAutomaticAna: true,
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, ANA_OUTBOUND_QUOTA_EXCEEDED_REASON);
});

test('cota nao bloqueia mensagem manual/humana', () => {
  const decision = evaluateAnaOutboundQuota({
    inboundCount: 1,
    anaOutboundCount: 10,
    isAutomaticAna: false,
  });

  assert.equal(decision.allowed, true);
  assert.equal(decision.reason, null);
});

test('conversa sem enterprise_id usa modelo barato default ou ANA_UNCLASSIFIED_ENTERPRISE_MODEL', () => {
  const previous = process.env.ANA_UNCLASSIFIED_ENTERPRISE_MODEL;
  delete process.env.ANA_UNCLASSIFIED_ENTERPRISE_MODEL;
  const defaultResolution = resolveAnaOpenAIModel({
    modelHotLeadFromDb: 'gpt-4.1',
    modelColdLeadFromDb: 'gpt-4.1',
    enterpriseResolved: false,
  });

  process.env.ANA_UNCLASSIFIED_ENTERPRISE_MODEL = 'gpt-cheap-test';
  const envResolution = resolveAnaOpenAIModel({
    modelHotLeadFromDb: 'gpt-4.1',
    modelColdLeadFromDb: 'gpt-4.1',
    enterpriseResolved: false,
  });

  if (previous === undefined) delete process.env.ANA_UNCLASSIFIED_ENTERPRISE_MODEL;
  else process.env.ANA_UNCLASSIFIED_ENTERPRISE_MODEL = previous;

  assert.equal(defaultResolution.finalModel, 'gpt-4.1-mini');
  assert.equal(defaultResolution.selectionReason, 'unclassified_enterprise_low_cost_model');
  assert.equal(envResolution.finalModel, 'gpt-cheap-test');
  assert.equal(envResolution.selectionReason, 'unclassified_enterprise_low_cost_model');
});

test('conversa com enterprise_id resolvido usa modelo normal atual', () => {
  const resolution = resolveAnaOpenAIModel({
    modelHotLeadFromDb: 'gpt-4.1',
    modelColdLeadFromDb: 'gpt-4.1-mini',
    enterpriseResolved: true,
  });

  assert.equal(resolution.finalModel, 'gpt-4.1');
  assert.equal(resolution.selectionReason, 'enterprise_resolved_standard_model');
});

test('openaiService nao envia configuracao de prioridade de tier', () => {
  const openaiServiceSource = readFileSync(new URL('../services/openaiService.js', import.meta.url), 'utf8');
  const serviceTierKey = ['service', 'tier'].join('_');
  const pKey = ['prior', 'ity'].join('');

  assert.equal(openaiServiceSource.includes(serviceTierKey), false);
  assert.equal(openaiServiceSource.includes(pKey), false);
});

test('policy humana da Ana fica centralizada no prompt', () => {
  const prompt = buildAnaSystemPrompt({
    mode: 'triage',
    enterprise: null,
    variablesMap: {},
    knowledgeText: '',
    fileInventory: '',
    allEnterpriseNames: [],
    isFirstAnaReply: true,
  });

  assert.equal(prompt.includes(ANA_HUMAN_ATTENDANCE_POLICY), true);
  assert.equal(prompt.includes('Escuta: entenda a intenção'), true);
  assert.equal(prompt.includes('Clareza: reduza o esforço mental'), true);
  assert.equal(prompt.includes('Empatia: reconheça necessidade'), true);
  assert.equal(prompt.includes('Precisão: use só informação sustentada'), true);
  assert.equal(prompt.includes('Condução: entregue um próximo passo'), true);
});

test('saudacao inicial seca ou robotica e bloqueada', () => {
  const dry = evaluateAnaEmptyFallbackGuard({
    reply: 'Oi, eu sou a Ana.',
    userMessage: 'Oi',
    isFirstAnaReply: true,
  });
  const good = evaluateAnaEmptyFallbackGuard({
    reply: 'Boa noite! Tudo bem? Me fala qual empreendimento você quer conhecer que eu te ajudo por aqui.',
    userMessage: 'Oi',
    isFirstAnaReply: true,
  });
  const multipleQuestions = evaluateAnaEmptyFallbackGuard({
    reply: 'Boa noite! Tudo bem? Você quer loteamento ou apartamento? É para morar ou investir?',
    userMessage: 'Oi',
    isFirstAnaReply: true,
  });

  assert.equal(dry.blocked, true);
  assert.equal(good.blocked, false);
  assert.equal(multipleQuestions.blocked, true);
});

test('pergunta objetiva nao pode virar permissao, formulario ou fallback', () => {
  const good = evaluateAnaEmptyFallbackGuard({
    reply: 'A metragem parte de 250 m², e o valor cadastrado começa em R$ 180.000.',
    userMessage: 'Quero saber a metragem e valor',
    knowledgeText: 'metragem: 250 m²\nvalor: R$ 180.000',
  });
  const emptyPhrase = evaluateAnaEmptyFallbackGuard({
    reply: 'Posso te explicar os principais pontos de forma objetiva.',
    userMessage: 'Quero saber a metragem e valor',
    knowledgeText: 'metragem: 250 m²\nvalor: R$ 180.000',
  });
  const earlyHandoff = evaluateAnaEmptyFallbackGuard({
    reply: 'Vou confirmar com o consultor e te retorno.',
    userMessage: 'Quero saber a metragem e valor',
    knowledgeText: 'metragem: 250 m²\nvalor: R$ 180.000',
  });

  assert.equal(good.blocked, false);
  assert.equal(emptyPhrase.blocked, true);
  assert.equal(earlyHandoff.blocked, true);
});

test('mensagem curta contextual sobre lazer precisa ser respondida, nao devolvida como pergunta', () => {
  const good = evaluateAnaEmptyFallbackGuard({
    reply: 'No lazer, a base cita piscina, academia e playground.',
    userMessage: 'Lazer',
    lastAssistantMessage: 'Estou vendo as informações desse empreendimento.',
    knowledgeText: 'lazer: piscina, academia, playground',
  });
  const bad = evaluateAnaEmptyFallbackGuard({
    reply: 'Lazer?',
    userMessage: 'Lazer',
    lastAssistantMessage: 'Estou vendo as informações desse empreendimento.',
    knowledgeText: 'lazer: piscina, academia, playground',
  });

  assert.equal(good.blocked, false);
  assert.equal(bad.blocked, true);
});

test('lead irritado deve receber tom de solucao, sem defensividade', () => {
  const good = evaluateAnaEmptyFallbackGuard({
    reply: 'Entendo o incômodo. Vou focar no ponto que você precisa agora e te responder com base no material que tenho aqui.',
    userMessage: 'Vocês não respondem nada direito',
  });
  const defensive = evaluateAnaEmptyFallbackGuard({
    reply: 'Como já expliquei, você precisa entender as informações antes de reclamar.',
    userMessage: 'Vocês não respondem nada direito',
  });

  assert.equal(good.blocked, false);
  assert.equal(defensive.blocked, true);
});

test('sem resposta segura nao envia fallback generico', () => {
  const outbound = evaluateAnaOutboundText({
    reply: 'Não consegui continuar daqui agora. Me manda novamente em uma frase o que você quer saber.',
    technicalFallbackText: 'Não consegui continuar daqui agora. Me manda novamente em uma frase o que você quer saber.',
    conversationType: 'CLIENT',
  });
  const materialUnavailable = pickMaterialUnavailableNeutralReply(null);
  const opGuard = applyOperationalFactGuard(
    'As obras estão avançadas e você já pode construir.',
    'Já pode construir?',
    ''
  );
  const axisGuard = applyAnaCommercialSingleAxisGuard({
    reply: 'Fica em Centro, tem 250 m² e custa R$ 180.000.',
    userMessage: 'Quero saber o valor',
    isFirstAnaReply: false,
  });

  assert.equal(outbound.valid, false);
  assert.equal(materialUnavailable, '');
  assert.equal(opGuard.blocked, true);
  assert.equal(opGuard.text, 'As obras estão avançadas e você já pode construir.');
  assert.equal(axisGuard.changed, false);
  assert.equal(axisGuard.text, 'Fica em Centro, tem 250 m² e custa R$ 180.000.');
});
