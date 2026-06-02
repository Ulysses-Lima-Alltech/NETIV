import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  evaluateFinalQuestionCheck,
  extractLastQuestionSentenceFromReply,
  inferCommittedQuestionType,
  mergeRecentQuestions,
} from '../utils/anaFinalQuestionPolicy.js';
import {
  isExplicitResolutionChoice,
  isSubstantiveQuestionThatBypassesResolutionChoice,
} from '../utils/anaKnowledgeGapGuard.js';

test('Teste 1: bypass de pending resolution detecta perguntas substantivas obrigatorias', () => {
  const samples = [
    'la tem seguranca?',
    'tem camera?',
    'quantos lotes tem?',
    'qual o valor?',
    'onde fica?',
    'me fala mais',
    'manda localizacao',
    'quais os tamanhos?',
    'tem portaria?',
    'como funciona o pagamento?',
  ];
  for (const sample of samples) {
    assert.equal(
      isSubstantiveQuestionThatBypassesResolutionChoice(sample),
      true,
      `esperado true para: "${sample}"`
    );
  }
});

test('Teste 2: escolha explicita de resolucao classifica corretor', () => {
  assert.equal(isExplicitResolutionChoice('quero corretor'), 'broker');
  assert.equal(isExplicitResolutionChoice('corretor'), 'broker');
  assert.equal(isExplicitResolutionChoice('corretor!!!!!!!!'), 'broker');
  assert.equal(isExplicitResolutionChoice('quero falar com um corretor'), 'broker');
  assert.equal(isExplicitResolutionChoice('falar com corretor'), 'broker');
  assert.equal(isExplicitResolutionChoice('me passa para um corretor'), 'broker');
  assert.equal(isExplicitResolutionChoice('me encaminha para um corretor'), 'broker');
  assert.equal(isExplicitResolutionChoice('atendimento humano'), 'broker');
  assert.equal(isExplicitResolutionChoice('quero falar com uma pessoa'), 'broker');
  assert.equal(isExplicitResolutionChoice('consultor'), 'broker');
  assert.equal(isExplicitResolutionChoice('falar com alguem'), 'broker');
  assert.equal(isExplicitResolutionChoice('me encaminha para atendimento humano'), 'broker');
});

test('Teste 3: escolha explicita de resolucao classifica visita', () => {
  assert.equal(isExplicitResolutionChoice('quero agendar visita'), 'visit');
  assert.equal(isExplicitResolutionChoice('marcar visita'), 'visit');
  assert.equal(isExplicitResolutionChoice('quero conhecer o stand'), 'visit');
});

test('Teste 4: escolha ambigua curta fica como ambiguous', () => {
  assert.equal(isExplicitResolutionChoice('sim'), 'ambiguous');
  assert.equal(isExplicitResolutionChoice('pode ser'), 'ambiguous');
  assert.equal(isExplicitResolutionChoice('ok'), 'ambiguous');
});

test('Teste 5: pergunta nova/substantiva nao vira escolha de resolucao', () => {
  assert.equal(isExplicitResolutionChoice('la tem seguranca?'), null);
  assert.equal(isExplicitResolutionChoice('quantos lotes tem?'), null);
});

test('Teste 6: check final marca missing quando resposta nao termina em pergunta', () => {
  const result = evaluateFinalQuestionCheck({
    replyText: 'O Evora fica em Atibaia com acesso pela Rodovia Dom Pedro I.',
    recentQuestions: [],
  });
  assert.equal(result.hasFinalQuestion, false);
  assert.equal(result.repeatedQuestion, false);
  assert.equal(result.forbiddenQuestion, false);
});

test('Teste 7: check final bloqueia pergunta repetida e frase proibida', () => {
  const repeated = evaluateFinalQuestionCheck({
    replyText: 'Temos portaria e controle de acesso. Quer que eu detalhe a estrutura de seguranca?',
    recentQuestions: ['Quer que eu detalhe a estrutura de seguranca?'],
  });
  assert.equal(repeated.hasFinalQuestion, true);
  assert.equal(repeated.repeatedQuestion, true);

  const forbidden = evaluateFinalQuestionCheck({
    replyText:
      'Posso te ajudar com isso. Desculpe, parece que sua resposta nao esta clara. Voce poderia escolher entre encaminhamento para o corretor responsavel ou agendamento de visita?',
    recentQuestions: [],
  });
  assert.equal(forbidden.hasFinalQuestion, true);
  assert.equal(forbidden.forbiddenQuestion, true);
});

test('Teste 8: extracao da ultima pergunta e inferencia do tipo ficam consistentes', () => {
  const lastQuestion = extractLastQuestionSentenceFromReply(
    'Eu nao tenho esse dado liberado com seguranca. Posso te encaminhar para o corretor responsavel ou te ajudar a agendar uma visita?'
  );
  assert.equal(lastQuestion, 'Posso te encaminhar para o corretor responsavel ou te ajudar a agendar uma visita?');
  assert.equal(inferCommittedQuestionType(lastQuestion), 'broker_or_visit_offer');

  const contextual = extractLastQuestionSentenceFromReply(
    'O empreendimento tem lazer completo. Quer que eu detalhe primeiro a parte de seguranca.'
  );
  assert.equal(contextual, 'Quer que eu detalhe primeiro a parte de seguranca?');
  assert.equal(inferCommittedQuestionType(contextual), 'contextual_followup');
});

test('engine contem logs e fluxo de retry obrigatorios para pergunta final', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'services/conversationEngine.ts'), 'utf8');
  assert.match(source, /\[ANA_FINAL_QUESTION_CHECK\]/);
  assert.match(source, /\[ANA_FINAL_QUESTION_RETRY_GENERATION\]/);
  assert.match(source, /\[ANA_FINAL_QUESTION_RETRY_ACCEPTED\]/);
  assert.match(source, /\[ANA_FINAL_QUESTION_RETRY_FAILED\]/);
  assert.match(source, /\[ANA_PENDING_RESOLUTION_BYPASSED_BY_SUBSTANTIVE_QUESTION\]/);
  assert.match(source, /Voce prefere que eu te encaminhe ao corretor ou que eu te ajude a agendar uma visita\?/);
});

test('broker assignment usa shouldAssignBroker com prioridade sobre visita', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'services/conversationEngine.ts'), 'utf8');
  assert.match(source, /if\s*\(\s*shouldAssignBroker\s*&&\s*brokerAssignReason\s*\)/);
  assert.match(source, /\[ANA_BROKER_EXPLICIT_REQUEST_DETECTED\]/);
  assert.match(source, /\[ANA_BROKER_ASSIGNMENT_BRANCH_ENTERED\]/);
  assert.match(source, /ana_pending_resolution_broker_choice/);
  assert.match(source, /ana_explicit_broker_request/);
  assert.match(source, /anaTurnAuditBlockedReason = `\$\{brokerAssignReason\}_send_failed`/);
  assert.match(source, /reason:\s*brokerAssignReason/);
  assert.doesNotMatch(source, /if\s*\(\s*explicitBrokerRequest\s*\)\s*\{/);

  const brokerBranchIndex = source.indexOf('if (shouldAssignBroker && brokerAssignReason)');
  const visitFlowIndex = source.indexOf('const rawDirectVisitSchedulingIntent = isVisitSchedulingIntent');
  assert.ok(brokerBranchIndex >= 0);
  assert.ok(visitFlowIndex >= 0);
  assert.ok(brokerBranchIndex < visitFlowIndex);
});

test('reason de broker prioriza pending resolution e fallback explicito', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'services/conversationEngine.ts'), 'utf8');
  assert.match(source, /\?\s*'pending_resolution_broker_choice'/);
  assert.match(source, /:\s*explicitBrokerRequest\s*\?\s*'explicit_broker_request'/);
});

test('pedido de visita continua classificado como visita', () => {
  assert.equal(isExplicitResolutionChoice('quero agendar visita'), 'visit');
});

test('mergeRecentQuestions deduplica e preserva perguntas recentes', () => {
  const merged = mergeRecentQuestions(
    ['Quer saber sobre localizacao?', 'Quer saber sobre localizacao?'],
    'Quer saber sobre seguranca?',
    6
  );
  assert.deepEqual(merged, ['Quer saber sobre localizacao?', 'Quer saber sobre seguranca?']);
});
