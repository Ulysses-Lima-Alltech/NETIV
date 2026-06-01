import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  ANA_HUMAN_ATTENDANCE_POLICY,
  buildAnaSystemPrompt,
} from '../services/anaAgentService.js';
import { applyAnaCommercialSingleAxisGuard } from '../utils/anaCommercialAxisGuard.js';
import { pickMaterialUnavailableNeutralReply } from '../utils/anaMaterialReply.js';
import { applyOperationalFactGuard } from '../utils/anaOperationalFactGuard.js';
import {
  applyFirstUsefulGreetingStyle,
  evaluateAnaEmptyFallbackGuard,
  evaluateAnaOutboundText,
  finalizeAnaReplyText,
  sanitizeTooManyQuestionsReply,
} from '../utils/anaReplyFinalize.js';
import { resolveAnaOpenAIModel } from '../utils/resolveAnaOpenAIModel.js';
import {
  applyAnaConversationPolicy,
  evaluateAnaReengagementPolicy,
  resolveRequestedTopicAction,
} from '../utils/anaConversationPolicy.js';
import { selectAnaNextFollowupQuestion, selectSingleSafeNextTopic } from '../utils/anaFollowupQuestionService.js';
import {
  handleVisitSchedulingDeterministically,
  isCommercialQuestionThatShouldBypassVisitScheduling,
  isExplicitVisitSchedulingAcceptance,
  isVisitSchedulingSlotAnswer,
  isVisitSchedulingConfirmationMessage,
  isVisitSchedulingIntent,
  isVisitSchedulingTopicSwitchMessage,
  reconstructVisitStateFromRecentMessages,
} from '../utils/anaDirectVisitScheduling.js';
import {
  __testOnlyResolveMediaPostSendFollowup,
  __testOnlySanitizeEvoraRestrictedKnowledgeForAna,
  __testOnlySplitAnaOutboundMessages,
} from '../services/conversationEngine.js';
import {
  extractCustomerNameFromUserUtterance,
  isUncertainCustomerNameCue,
} from '../utils/extractCustomerNameFromMessage.js';
import {
  resolveShortConfirmationContext,
  shouldSuppressVisitFlowForConfirmationKind,
} from '../utils/anaShortConfirmationContext.js';
import { resolveAnaCommercialRule } from '../services/anaCommercialRulesService.js';
import { applyAnaNoRepeatMessageGuard } from '../utils/anaEvoraCommercialGuards.js';
import { buildAnaEnterpriseEvidence } from '../utils/anaEnterpriseEvidence.js';
import type { CommercialFlowState } from '../utils/commercialFlowState.js';

test('resolve modelo da Ana por DB com gpt-4.1', () => {
  const resolution = resolveAnaOpenAIModel({
    configuredModelFromDb: 'gpt-4.1',
    slot: 'hot_lead',
    provider: 'openai',
  });
  assert.equal(resolution.blocked, false);
  if (!resolution.blocked) {
    assert.equal(resolution.finalModel, 'gpt-4.1');
    assert.equal(resolution.sourceOfFinalModel, 'db');
  }
});

test('resolve modelo da Ana por DB com gpt-5.1', () => {
  const resolution = resolveAnaOpenAIModel({
    configuredModelFromDb: 'gpt-5.1',
    slot: 'hot_lead',
    provider: 'openai',
  });
  assert.equal(resolution.blocked, false);
  if (!resolution.blocked) {
    assert.equal(resolution.finalModel, 'gpt-5.1');
    assert.equal(resolution.sourceOfFinalModel, 'db');
  }
});

test('ignora OPENAI_MODEL quando DB esta definido', () => {
  const previous = process.env.OPENAI_MODEL;
  process.env.OPENAI_MODEL = 'gpt-4.1';
  const resolution = resolveAnaOpenAIModel({
    configuredModelFromDb: 'gpt-5.1',
    slot: 'hot_lead',
    provider: 'openai',
  });
  if (previous === undefined) delete process.env.OPENAI_MODEL;
  else process.env.OPENAI_MODEL = previous;

  assert.equal(resolution.blocked, false);
  if (!resolution.blocked) {
    assert.equal(resolution.finalModel, 'gpt-5.1');
    assert.equal(resolution.sourceOfFinalModel, 'db');
  }
});

test('bloqueia quando modelo da Ana nao esta configurado no DB', () => {
  const resolution = resolveAnaOpenAIModel({
    configuredModelFromDb: null,
    slot: 'hot_lead',
    provider: 'openai',
  });
  assert.equal(resolution.blocked, true);
  if (resolution.blocked) {
    assert.equal(resolution.reason, 'ana_model_not_configured');
    assert.equal(resolution.sourceOfFinalModel, 'db');
  }
});

test('bloqueia quando modelo da Ana no DB e invalido para slot', () => {
  const resolution = resolveAnaOpenAIModel({
    configuredModelFromDb: 'gpt-foo-invalido',
    slot: 'hot_lead',
    provider: 'openai',
  });
  assert.equal(resolution.blocked, true);
  if (resolution.blocked) {
    assert.equal(resolution.reason, 'ana_model_invalid_for_slot');
    assert.equal(resolution.sourceOfFinalModel, 'db');
  }
});

test('nunca retorna source env/default na resolucao da Ana', () => {
  const ok = resolveAnaOpenAIModel({ configuredModelFromDb: 'gpt-4.1', slot: 'hot_lead', provider: 'openai' });
  const blocked = resolveAnaOpenAIModel({ configuredModelFromDb: null, slot: 'hot_lead', provider: 'openai' });

  assert.equal(ok.sourceOfFinalModel, 'db');
  assert.equal(blocked.sourceOfFinalModel, 'db');
});

test('OPENAI_API_KEY e OPENAI_BASE_URL permanecem apenas como infraestrutura', () => {
  const prevKey = process.env.OPENAI_API_KEY;
  const prevBase = process.env.OPENAI_BASE_URL;
  process.env.OPENAI_API_KEY = 'sk-infra-only';
  process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1';

  const resolution = resolveAnaOpenAIModel({
    configuredModelFromDb: 'gpt-4.1',
    slot: 'hot_lead',
    provider: 'openai',
  });

  if (prevKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = prevKey;
  if (prevBase === undefined) delete process.env.OPENAI_BASE_URL;
  else process.env.OPENAI_BASE_URL = prevBase;

  assert.equal(resolution.blocked, false);
  if (!resolution.blocked) assert.equal(resolution.finalModel, 'gpt-4.1');
});

test('aceita gpt-4.1-nano com provider openai', () => {
  const resolution = resolveAnaOpenAIModel({
    configuredModelFromDb: 'gpt-4.1-nano',
    slot: 'hot_lead',
    provider: 'openai',
  });
  assert.equal(resolution.blocked, false);
});

test('aceita openai/gpt-4.1-nano com provider openrouter', () => {
  const resolution = resolveAnaOpenAIModel({
    configuredModelFromDb: 'openai/gpt-4.1-nano',
    slot: 'hot_lead',
    provider: 'openrouter',
  });
  assert.equal(resolution.blocked, false);
});

test('bloqueia openai/gpt-4.1-nano com provider openai', () => {
  const resolution = resolveAnaOpenAIModel({
    configuredModelFromDb: 'openai/gpt-4.1-nano',
    slot: 'hot_lead',
    provider: 'openai',
  });
  assert.equal(resolution.blocked, true);
  if (resolution.blocked) {
    assert.equal(resolution.reason, 'ana_model_invalid_for_slot');
  }
});

test('aceita ana-evora-qwen-8k-v2:latest com baseUrl custom', () => {
  const resolution = resolveAnaOpenAIModel({
    configuredModelFromDb: 'ana-evora-qwen-8k-v2:latest',
    slot: 'hot_lead',
    baseUrl: 'https://teste.trycloudflare.com/v1',
  });
  assert.equal(resolution.blocked, false);
});

test('aceita qwen2.5:7b-instruct com provider local/custom', () => {
  const localProvider = resolveAnaOpenAIModel({
    configuredModelFromDb: 'qwen2.5:7b-instruct',
    slot: 'cold_lead',
    provider: 'local',
  });
  const customProvider = resolveAnaOpenAIModel({
    configuredModelFromDb: 'qwen2.5:7b-instruct',
    slot: 'cold_lead',
    provider: 'custom',
  });
  assert.equal(localProvider.blocked, false);
  assert.equal(customProvider.blocked, false);
});

test('bloqueia ana-evora-qwen-8k-v2:latest com baseUrl OpenAI', () => {
  const resolution = resolveAnaOpenAIModel({
    configuredModelFromDb: 'ana-evora-qwen-8k-v2:latest',
    slot: 'hot_lead',
    baseUrl: 'https://api.openai.com/v1',
  });
  assert.equal(resolution.blocked, true);
  if (resolution.blocked) assert.equal(resolution.reason, 'ana_model_invalid_for_slot');
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
  assert.equal(prompt.toLowerCase().includes('escuta') || prompt.toLowerCase().includes('clareza'), true);
});

test('saudacao inicial seca ou robotica e bloqueada', () => {
  const dry = evaluateAnaEmptyFallbackGuard({
    reply: 'Oi, eu sou a Ana.',
    userMessage: 'Oi',
    isFirstAnaReply: true,
  });
  const good = evaluateAnaEmptyFallbackGuard({
    reply: 'Olá, boa noite, tudo bem? Me fala qual empreendimento voce quer conhecer que eu te ajudo por aqui.',
    userMessage: 'Oi',
    isFirstAnaReply: true,
  });
  const multipleQuestions = evaluateAnaEmptyFallbackGuard({
    reply: 'Olá, boa noite, tudo bem? Voce quer loteamento ou apartamento? E para morar ou investir?',
    userMessage: 'Oi',
    isFirstAnaReply: true,
  });

  assert.equal(dry.blocked, true);
  assert.equal(good.blocked, false);
  assert.equal(multipleQuestions.blocked, true);
});

test('primeira resposta comercial util sem saudacao recebe patch local', () => {
  const original =
    'Temos unidades a partir de 250 m2 com lazer completo e condicoes atuais a partir de R$ 180.000.';
  const blocked = evaluateAnaEmptyFallbackGuard({
    reply: original,
    userMessage: 'Qual o valor e metragem?',
    isFirstAnaReply: true,
  });
  const patched = applyFirstUsefulGreetingStyle({
    text: original,
    isFirstAnaReply: true,
  });
  const afterPatch = evaluateAnaEmptyFallbackGuard({
    reply: patched.text,
    userMessage: 'Qual o valor e metragem?',
    isFirstAnaReply: true,
  });

  assert.equal(blocked.blocked, true);
  assert.equal(blocked.reason, 'first_reply_missing_greeting');
  assert.equal(patched.changed, true);
  assert.match(patched.greeting ?? '', /^Olá, (bom dia|boa tarde|boa noite), tudo bem\?$/i);
  assert.match(patched.text, /^Olá, (bom dia|boa tarde|boa noite), tudo bem\?\s+/i);
  assert.equal(afterPatch.blocked, false);
});

test('observabilidade: engine registra decisão de chamada do Qwen e contexto', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'services/conversationEngine.ts'), 'utf8');
  assert.match(source, /\[ANA_LLM_DECISION\]/);
  assert.match(source, /\[ANA_QWEN_REQUEST_CONTEXT\]/);
  assert.match(source, /\[ANA_QWEN_RAW_RESPONSE\]/);
  assert.match(source, /\[ANA_QWEN_PARSE_RESULT\]/);
  assert.match(source, /\[ANA_QWEN_GUARDRAIL_DECISION\]/);
  assert.match(source, /\[ANA_QWEN_RESPONSE_REPLACED\]/);
  assert.match(source, /\[ANA_QWEN_SKIPPED_BY_DETERMINISTIC\]/);
});

test('modo conversacional local/Qwen permite texto natural com responseFormatJson false', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'services/conversationEngine.ts'), 'utf8');
  assert.match(source, /const responseFormatJsonForTurn = !conversationalQwenMode/);
  assert.match(source, /responseFormatJson: responseFormatJsonForTurn/);
});

test('fallback genérico ruim é rastreado explicitamente', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'services/conversationEngine.ts'), 'utf8');
  assert.match(source, /\[ANA_BAD_GENERIC_FALLBACK_USED\]/);
  assert.match(source, /technical_fallback_phrase_guard/);
});

test('debug raw do Qwen pode ser ligado por variável de ambiente', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'services/conversationEngine.ts'), 'utf8');
  assert.match(source, /ANA_DEBUG_QWEN_RAW/);
});

test('patch local de saudacao nao mascara resposta curta e pouco util', () => {
  const patched = applyFirstUsefulGreetingStyle({
    text: 'Temos sim.',
    isFirstAnaReply: true,
  });

  assert.equal(patched.changed, false);
  assert.equal(patched.greeting, null);
});

test('pergunta objetiva nao pode virar permissao, formulario ou fallback', () => {
  const good = evaluateAnaEmptyFallbackGuard({
    reply: 'A metragem parte de 250 mÂ², e o valor cadastrado comeÃ§a em R$ 180.000.',
    userMessage: 'Quero saber a metragem e valor',
    knowledgeText: 'metragem: 250 mÂ²\nvalor: R$ 180.000',
  });
  const emptyPhrase = evaluateAnaEmptyFallbackGuard({
    reply: 'Posso te explicar os principais pontos de forma objetiva.',
    userMessage: 'Quero saber a metragem e valor',
    knowledgeText: 'metragem: 250 mÂ²\nvalor: R$ 180.000',
  });
  const earlyHandoff = evaluateAnaEmptyFallbackGuard({
    reply: 'Vou confirmar com o consultor e te retorno.',
    userMessage: 'Quero saber a metragem e valor',
    knowledgeText: 'metragem: 250 mÂ²\nvalor: R$ 180.000',
  });

  assert.equal(good.blocked, false);
  assert.equal(emptyPhrase.blocked, true);
  assert.equal(earlyHandoff.blocked, true);
});

test('mensagem curta contextual sobre lazer precisa ser respondida, nao devolvida como pergunta', () => {
  const good = evaluateAnaEmptyFallbackGuard({
    reply: 'No lazer, a base cita piscina, academia e playground.',
    userMessage: 'Lazer',
    lastAssistantMessage: 'Estou vendo as informaÃ§Ãµes desse empreendimento.',
    knowledgeText: 'lazer: piscina, academia, playground',
  });
  const bad = evaluateAnaEmptyFallbackGuard({
    reply: 'Lazer?',
    userMessage: 'Lazer',
    lastAssistantMessage: 'Estou vendo as informaÃ§Ãµes desse empreendimento.',
    knowledgeText: 'lazer: piscina, academia, playground',
  });

  assert.equal(good.blocked, false);
  assert.equal(bad.blocked, true);
});

test('lead irritado deve receber tom de solucao, sem defensividade', () => {
  const good = evaluateAnaEmptyFallbackGuard({
    reply: 'Entendo o incomodo. Vou focar no ponto que voce precisa agora e te responder com base no material que tenho aqui.',
    userMessage: 'Voces nao respondem nada direito',
  });
  const defensive = evaluateAnaEmptyFallbackGuard({
    reply: 'Como ja expliquei, voce precisa entender as informacoes antes de reclamar.',
    userMessage: 'Voces nao respondem nada direito',
  });

  assert.equal(good.blocked, false);
  assert.equal(defensive.blocked, true);
});

test('sem resposta segura nao envia fallback generico', () => {
  const outbound = evaluateAnaOutboundText({
    reply: 'NÃ£o consegui continuar daqui agora. Me manda novamente em uma frase o que vocÃª quer saber.',
    technicalFallbackText: 'NÃ£o consegui continuar daqui agora. Me manda novamente em uma frase o que vocÃª quer saber.',
    conversationType: 'CLIENT',
  });
  const materialUnavailable = pickMaterialUnavailableNeutralReply(null);
  const opGuard = applyOperationalFactGuard(
    'As obras estÃ£o avanÃ§adas e vocÃª jÃ¡ pode construir.',
    'JÃ¡ pode construir?',
    ''
  );
  const axisGuard = applyAnaCommercialSingleAxisGuard({
    reply: 'Fica em Centro, tem 250 mÂ² e custa R$ 180.000.',
    userMessage: 'Quero saber o valor',
    isFirstAnaReply: false,
  });

  assert.equal(outbound.valid, false);
  assert.equal(materialUnavailable, '');
  assert.equal(opGuard.blocked, true);
  assert.equal(opGuard.text, 'As obras estÃ£o avanÃ§adas e vocÃª jÃ¡ pode construir.');
  assert.equal(axisGuard.changed, false);
  assert.equal(axisGuard.text, 'Fica em Centro, tem 250 mÂ² e custa R$ 180.000.');
});

test('sanitiza resposta valida com perguntas finais em excesso sem esvaziar conteudo', () => {
  const input =
    'O Evora e um loteamento fechado em Atibaia com boa infraestrutura e opcoes de lazer. Quer ver localizacao em detalhes? Quer que eu te explique lazer ou condicoes de compra?';
  const output = sanitizeTooManyQuestionsReply(input);

  assert.equal(output.length > 0, true);
  assert.equal((output.match(/\?/g) || []).length <= 1, true);
  assert.match(output, /loteamento fechado em Atibaia/i);
  const hasSafeQuestion =
    output.includes('Quer que eu te fale mais sobre a localização?') ||
    output.includes('Quer saber mais sobre a localização ou prefere falar com um corretor?') ||
    output.includes('Quer que eu te fale mais sobre a localizacao?') ||
    output.includes('Quer saber mais sobre a localizacao ou prefere falar com um corretor?');
  assert.equal(hasSafeQuestion, true);
});

test('finalizeAnaReplyText bloqueia placeholder de lotes e roteia para resposta segura', () => {
  const output = finalizeAnaReplyText(
    'O Residencial Évora possui um total de [número de lotes] lotes.',
    { userMessage: 'Lá são quantos lotes?' }
  );
  assert.equal(
    output,
    'Esse detalhe o corretor consegue te passar certinho no atendimento. O que posso te adiantar é que o Évora é um loteamento fechado em Atibaia, com lotes de 360 m² até 725 m².'
  );
});

test('finalizeAnaReplyText bloqueia numero exato de lotes e roteia para resposta segura', () => {
  const output = finalizeAnaReplyText('O Évora tem 145 lotes.', {
    userMessage: 'Lá são quantos lotes?',
  });
  assert.equal(
    output,
    'Esse detalhe o corretor consegue te passar certinho no atendimento. O que posso te adiantar é que o Évora é um loteamento fechado em Atibaia, com lotes de 360 m² até 725 m².'
  );
});

test('finalizeAnaReplyText bloqueia resposta generica de falta de informacao para porte/quantidade', () => {
  const output = finalizeAnaReplyText('Não temos informações específicas sobre o número total de lotes.', {
    userMessage: 'É um condomínio grande?',
  });
  assert.equal(
    output,
    'Esse detalhe o corretor consegue te passar certinho no atendimento. O que posso te adiantar é que o Évora é um loteamento fechado em Atibaia, com lotes de 360 m² até 725 m².'
  );
});

test('finalizeAnaReplyText nao aplica fallback de lotes para pergunta de localizacao', () => {
  const output = finalizeAnaReplyText('O Évora fica em Atibaia, com acesso pela Rodovia Dom Pedro I.', {
    userMessage: 'Onde fica?',
  });
  assert.equal(
    output ===
      'Esse detalhe o corretor consegue te passar certinho no atendimento. O que posso te adiantar é que o Évora é um loteamento fechado em Atibaia, com lotes de 360 m² até 725 m².',
    false
  );
  assert.match(output, /atibaia|rodovia dom pedro/i);
});

test('finalizeAnaReplyText nao aplica fallback de lotes para pergunta de valor', () => {
  const output = finalizeAnaReplyText('O valor inicial parte de R$ 279.000,00.', {
    userMessage: 'Quanto está o lote?',
  });
  assert.equal(
    output ===
      'Esse detalhe o corretor consegue te passar certinho no atendimento. O que posso te adiantar é que o Évora é um loteamento fechado em Atibaia, com lotes de 360 m² até 725 m².',
    false
  );
  assert.match(output, /r\$\s*279\.000,00|valor inicial/i);
});

test('sanitizacao de knowledge do evora mascara quantidade total de lotes', () => {
  const output = __testOnlySanitizeEvoraRestrictedKnowledgeForAna(
    'Quantidade total de lotes: 145\nÁrea total: 128.027,28 m²\nLotes de 360 m² até 725 m²'
  );
  assert.match(output, /Quantidade total de lotes: informação tratada pelo corretor/i);
  assert.equal(/\b145\b/.test(output), false);
  assert.match(output, /128\.027,28 m²|360 m²|725 m²/i);
});

test('anaEnterpriseEvidence marca preco quando existe apenas no knowledgeText', () => {
  const evidence = buildAnaEnterpriseEvidence({
    enterprise: { city: 'Atibaia' } as any,
    files: [],
    variablesMap: {},
    knowledgeText: 'Valor inicial: A partir de R$279.000,00.',
  });

  assert.equal(evidence.hasPricingInfo, true);
});

test('anaEnterpriseEvidence marca financiamento quando existe apenas no knowledgeText', () => {
  const evidence = buildAnaEnterpriseEvidence({
    enterprise: { city: 'Atibaia' } as any,
    files: [],
    variablesMap: {},
    knowledgeText: 'Entrada/sinal: 20%. Sem juros em até 48x + IGPM. Em até 120x com juros + IGPM.',
  });

  assert.equal(evidence.hasFinancingInfo, true);
});

test('finalizeAnaReplyText força endereço canônico do Évora em resposta genérica', () => {
  const output = finalizeAnaReplyText('Tem algum ponto específico que você quer que eu detalhe melhor?', {
    enterpriseName: 'Residencial Évora',
    userMessage: 'Qual é o endereço completo?',
  });

  assert.equal(output, 'Fica na Estrada dos Pires, s/n, na região da Pedreira, bairro Rio Abaixo, em Atibaia.');
});

test('finalizeAnaReplyText força Google Maps canônico do Évora', () => {
  const output = finalizeAnaReplyText('Posso te ajudar com mais detalhes do empreendimento.', {
    enterpriseName: 'Residencial Évora',
    userMessage: 'Me manda o Google Maps.',
  });

  assert.equal(
    output,
    'Posso te enviar sim. O link do Évora no Google Maps é: https://maps.app.goo.gl/jBoxPM6XRut2iXHSA?g_st=ic'
  );
});

test('finalizeAnaReplyText força lazer canônico do Évora em fallback genérico', () => {
  const output = finalizeAnaReplyText('Tem algum ponto específico que você quer que eu detalhe melhor?', {
    enterpriseName: 'Residencial Évora',
    userMessage: 'Quais são as áreas de lazer?',
  });

  assert.equal(
    output,
    'O Évora conta com lazer completo: piscina adulto, piscina infantil, academia, salão de festas, playground, coworking, espaço zen, fireplace, quadra de beach tennis, campo society, praça interna e área verde.'
  );
});

test('finalizeAnaReplyText corrige preço do Évora quando modelo diz não divulgado', () => {
  const output = finalizeAnaReplyText('O preço dos lotes no Évora ainda não foi divulgado oficialmente.', {
    enterpriseName: 'Residencial Évora',
    userMessage: 'Quanto está o lote?',
  });

  assert.equal(output, 'O valor inicial do Évora é a partir de R$279.000,00, e o metro quadrado começa em R$775,00.');
});

test('finalizeAnaReplyText aplica resposta canônica de formas de pagamento do Évora', () => {
  const output = finalizeAnaReplyText('Tem algum ponto específico que você quer que eu detalhe melhor?', {
    enterpriseName: 'Residencial Évora',
    userMessage: 'Como funcionam as formas de pagamento?',
  });

  assert.equal(
    output,
    'A entrada padrão é de 20%. Para parcelas mais baixas, temos planos estendidos em até 120x; para parcelamento sem juros, temos planos em até 48x + IGPM. O financiamento é direto com a construtora, com menos burocracia.'
  );
});

test('finalizeAnaReplyText aplica redirect de parcela do Évora', () => {
  const output = finalizeAnaReplyText('Hoje trabalhamos com condições variadas.', {
    enterpriseName: 'Residencial Évora',
    userMessage: 'Esse valor parcela?',
  });

  assert.equal(
    output,
    'A simulação certinha depende do lote e do plano escolhido. O corretor te passa tudo direitinho no atendimento. Que tal marcarmos uma visita?'
  );
});

test('finalizeAnaReplyText mantém bloqueio de quantidade total de lotes após rescues canônicos', () => {
  const output = finalizeAnaReplyText('O Évora tem 145 lotes.', {
    enterpriseName: 'Residencial Évora',
    userMessage: 'Lá são quantos lotes?',
  });

  assert.equal(
    output,
    'Esse detalhe o corretor consegue te passar certinho no atendimento. O que posso te adiantar é que o Évora é um loteamento fechado em Atibaia, com lotes de 360 m² até 725 m².'
  );
  assert.equal(/\b145\b/.test(output), false);
});

test('finalizeAnaReplyText corrige eixo de desconto quando resposta mistura condominio/taxa', () => {
  const output = finalizeAnaReplyText(
    'Desconto ainda não está definido com precisão, pois depende das decisões dos moradores e da associação do condomínio. Hoje trabalhamos com uma estimativa entre R$400,00 e R$700,00 para a taxa de condomínio.',
    { userMessage: 'Tem desconto?' }
  );
  const normalized = output.normalize('NFD').replace(/\p{M}/gu, '');
  assert.equal(
    normalized,
    'Desconto ou condicao especial depende de analise. O corretor consegue te passar isso certinho no atendimento. Que tal marcarmos uma visita?'
  );
});

test('finalizeAnaReplyText corrige eixo para negociacao com resposta misturada de taxa/condominio', () => {
  const output = finalizeAnaReplyText(
    'Dá pra negociar, mas a taxa de condomínio varia e fica entre R$400 e R$700.',
    { userMessage: 'Dá pra negociar?' }
  );
  const normalized = output.normalize('NFD').replace(/\p{M}/gu, '');
  assert.equal(
    normalized,
    'Desconto ou condicao especial depende de analise. O corretor consegue te passar isso certinho no atendimento. Que tal marcarmos uma visita?'
  );
});

test('finalizeAnaReplyText mantem resposta de condominio quando pergunta e sobre condominio', () => {
  const output = finalizeAnaReplyText('Hoje trabalhamos com uma estimativa entre R$400,00 e R$700,00.', {
    userMessage: 'Tem condomínio?',
  });
  const normalized = output.normalize('NFD').replace(/\p{M}/gu, '');
  assert.equal(
    normalized ===
      'Desconto ou condicao especial depende de analise. O corretor consegue te passar isso certinho no atendimento. Que tal marcarmos uma visita?',
    false
  );
  assert.match(normalized, /r\$400,00|r\$700,00|estimativa/i);
});

test('finalizeAnaReplyText nao aplica sanitizer de desconto para pergunta de valor do lote', () => {
  const output = finalizeAnaReplyText('O valor inicial parte de R$ 279.000,00.', {
    userMessage: 'Quanto estÃ¡ o lote?',
  });
  const normalized = output.normalize('NFD').replace(/\p{M}/gu, '');
  assert.equal(
    normalized ===
      'Desconto ou condicao especial depende de analise. O corretor consegue te passar isso certinho no atendimento. Que tal marcarmos uma visita?',
    false
  );
  assert.match(normalized, /r\$\s*279\.000,00|valor inicial/i);
});

test('regra first_contact do Evora nao inclui pergunta fixa de qualificacao', () => {
  const rule = resolveAnaCommercialRule({
    enterpriseName: 'Evora',
    userMessage: 'Oi, tenho interesse no Evora',
    isFirstAnaReply: true,
  });

  assert.equal(rule != null, true);
  const combined = (rule?.messages ?? []).join(' ');
  assert.equal(/morar,\s*investir\s+ou\s+construir/i.test(combined), false);
});

test('finalizeAnaReplyText remove pergunta fixa proibida e preserva parte informativa', () => {
  const output = finalizeAnaReplyText(
    'Olá! O Évora é um loteamento fechado em Atibaia, na região da Pedreira, com lotes a partir de 360 m², lazer completo e segurança 24 horas. Você está buscando o lote para morar, investir ou construir?',
    {
      enterpriseName: 'Residencial Évora',
      userMessage: 'Oi, queria saber mais sobre o Évora',
      isFirstAnaReply: true,
    }
  );

  assert.equal(/morar,\s*investir\s+ou\s+construir/i.test(output), false);
  assert.match(output, /Évora|Atibaia|Pedreira/i);
});

test('fallback seguro de primeira resposta no engine nao contem pergunta fixa', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'services/conversationEngine.ts'), 'utf8');
  const safeFallbackLine = source.match(/function buildEvoraFirstReplySafeFallback\(\): string \{\s*return '([^']+)'/);

  assert.equal(safeFallbackLine != null, true);
  assert.equal(/morar,\s*investir\s+ou\s+construir/i.test(safeFallbackLine?.[1] ?? ''), false);
});

test('codigo produtivo nao contem frase fixa de qualificacao', () => {
  const serverRoot = path.resolve(process.cwd());
  const deny = /(morar,\s*investir\s+ou\s+construir|morar investir construir|Você está buscando|voce esta buscando)/i;
  const allowTestFile = /server[\\\/]tests[\\\/]anaCostContainment\.test\.ts$/i;

  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (/([\\\/]|^)dist$/i.test(abs)) continue;
        walk(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!abs.endsWith('.ts')) continue;
      files.push(abs);
    }
  };
  walk(serverRoot);

  const offenders: string[] = [];
  for (const abs of files) {
    const rel = path.relative(serverRoot, abs).replace(/\\/g, '/');
    const content = readFileSync(abs, 'utf8');
    if (allowTestFile.test(abs)) continue;
    if (deny.test(content)) offenders.push(rel);
  }

  assert.deepEqual(offenders, []);
});

test('reengagement bloqueia inbound e outbound recentes', () => {
  const now = new Date('2026-05-25T15:00:00.000Z');
  const inboundRecent = evaluateAnaReengagementPolicy({
    now,
    minIdleMinutes: 60,
    lastInboundAt: new Date('2026-05-25T14:35:00.000Z'),
    lastOutboundAt: new Date('2026-05-25T12:00:00.000Z'),
  });
  const outboundRecent = evaluateAnaReengagementPolicy({
    now,
    minIdleMinutes: 60,
    lastInboundAt: new Date('2026-05-25T11:00:00.000Z'),
    lastOutboundAt: new Date('2026-05-25T14:40:00.000Z'),
  });
  const idleEnough = evaluateAnaReengagementPolicy({
    now,
    minIdleMinutes: 60,
    lastInboundAt: new Date('2026-05-25T11:00:00.000Z'),
    lastOutboundAt: new Date('2026-05-25T12:10:00.000Z'),
  });

  assert.equal(inboundRecent.allowed, false);
  assert.equal(inboundRecent.reason, 'recent_inbound');
  assert.equal(outboundRecent.allowed, false);
  assert.equal(outboundRecent.reason, 'recent_outbound');
  assert.equal(idleEnough.allowed, true);
});

test('captura sabado de manha e pergunta apenas horario', () => {
  const baseState: CommercialFlowState = {};
  const decision = handleVisitSchedulingDeterministically({
    userMessage: 'Acho que consigo no sábado de manhã',
    flowState: baseState,
    enterpriseId: 10,
    customerName: null,
    customerPhone: '11999990000',
    referenceNow: new Date('2026-05-25T12:00:00.000Z'),
  });

  assert.equal(decision.handled, true);
  assert.equal(decision.extractedPeriod, 'manha');
  assert.equal(decision.missingSlot, 'periodo_ou_horario');
  assert.equal(decision.pendingVisitScheduling, true);
  assert.match(decision.reply ?? '', /qual hor/i);
});

test('apelido nao vira nome automaticamente', () => {
  const extracted = extractCustomerNameFromUserUtterance('Pode me chamar de Mestre');
  const uncertain = isUncertainCustomerNameCue('Mestre kkk');

  assert.equal(extracted, null);
  assert.equal(uncertain, true);
});

test('pedido direto de lazer responde conteudo sem loop de oferta', () => {
  const policy = applyAnaConversationPolicy({
    conversationId: 1,
    userMessage: 'Quais areas de lazer tem?',
    replyText: 'Tem piscinas, academia, playground e areas de convivencia.',
    isFirstAnaReply: false,
    flowState: {},
    recentMessages: [
      { role: 'user', content: 'Quais areas de lazer tem?' },
    ],
    knownCustomerName: null,
    probableCustomerName: null,
    disableFollowupQuestion: false,
  });

  assert.match(policy.text, /as areas de lazer do evora incluem|piscina adulto/i);
  assert.equal(/quer que eu te explique as areas de lazer/i.test(policy.text), false);
  assert.equal(/agendar|visita|corretor/i.test(policy.text), false);
});
test('pedido de simulacao puxa pergunta de corretor', () => {
  const policy = applyAnaConversationPolicy({
    conversationId: 2,
    userMessage: 'Consegue simular uma parcela personalizada?',
    replyText: 'Esse é o valor inicial do lote.',
    isFirstAnaReply: false,
    flowState: {},
    recentMessages: [
      { role: 'user', content: 'Consegue simular uma parcela personalizada?' },
    ],
    knownCustomerName: null,
    probableCustomerName: null,
    disableFollowupQuestion: false,
  });

  assert.match(policy.text, /quer que eu encaminhe para um corretor te passar certinho\?/i);
});

test('fluxo de visita ativo suprime oferta de midia e ancora no slot faltante', () => {
  const policy = applyAnaConversationPolicy({
    conversationId: 3,
    userMessage: 'Tá bom',
    replyText: 'Posso te enviar um vídeo e o book também.',
    isFirstAnaReply: false,
    flowState: {
      pendingVisitScheduling: true,
      pendingVisitDateLabel: 'sábado',
      pendingVisitDate: '2026-05-30',
      pendingVisitPeriod: 'manha',
      pendingVisitTime: null,
    },
    recentMessages: [
      { role: 'assistant', content: 'Perfeito, sábado de manhã. Qual horário fica melhor para você?' },
      { role: 'user', content: 'Tá bom' },
    ],
    knownCustomerName: null,
    probableCustomerName: null,
    disableFollowupQuestion: true,
    visitFlowActive: true,
  });

  assert.equal(/vídeo|video|book/i.test(policy.text), false);
  assert.match(policy.text, /qual hor/i);
});

test('cta repetido em sequencia e suprimido', () => {
  const policy = applyAnaConversationPolicy({
    conversationId: 4,
    userMessage: 'Entendi',
    replyText: 'O valor inicial é esse. Se quiser, posso te ajudar a agendar uma visita.',
    isFirstAnaReply: false,
    flowState: {},
    recentMessages: [
      { role: 'assistant', content: 'Se fizer sentido para você, posso te ajudar a agendar uma visita.' },
      { role: 'user', content: 'Entendi' },
    ],
    knownCustomerName: null,
    probableCustomerName: null,
    disableFollowupQuestion: true,
  });

  assert.equal(/agendar uma visita/i.test(policy.text), false);
});

test('"sim" apos pergunta de formas de pagamento explica pagamento e nao inicia visita', () => {
  const recentMessages = [
    { role: 'assistant' as const, content: 'Quer que eu te explique as formas de pagamento?' },
    { role: 'user' as const, content: 'sim' },
  ];
  const context = resolveShortConfirmationContext({
    userText: 'sim',
    recentMessages,
    lastAssistantMessage: recentMessages[0].content,
    flowState: {},
  });

  assert.equal(context.kind, 'followup_topic_confirmation');
  assert.equal(context.source, 'history');
  assert.equal(context.lastOfferedTopics.includes('formas_pagamento'), true);

  const shouldScheduleVisit = isVisitSchedulingIntent({
    userMessage: 'sim',
    flowState: {},
    confirmationContextKind: context.kind,
    resolvedIntent: 'visita_agendamento',
    primaryAxis: 'visita_agendamento',
    currentAxis: 'visita_agendamento',
    requestedAxis: 'visita_agendamento',
    lastAssistantMessage: recentMessages[0].content,
    enterpriseId: 10,
    referenceNow: new Date('2026-05-25T12:00:00.000Z'),
  });
  assert.equal(shouldScheduleVisit, false);

  const policy = applyAnaConversationPolicy({
    conversationId: 5,
    userMessage: 'sim',
    replyText: 'Perfeito. Para qual dia voce prefere agendar a visita?',
    isFirstAnaReply: false,
    flowState: {},
    recentMessages,
    disableFollowupQuestion: true,
    shortConfirmationContext: {
      kind: context.kind,
      lastAssistantQuestionType: context.lastAssistantQuestionType,
      lastAssistantQuestionText: context.lastAssistantQuestionText,
      lastOfferedTopics: context.lastOfferedTopics,
    },
  });
  assert.equal(/agendar|visita/i.test(policy.text), false);
  assert.match(policy.text, /formas de pagamento|pagamento/i);
});

test('"sim" apos oferta explicita de visita inicia fluxo de agendamento', () => {
  const context = resolveShortConfirmationContext({
    userText: 'sim',
    recentMessages: [
      { role: 'assistant', content: 'Quer que eu te ajude a agendar uma visita?' },
      { role: 'user', content: 'sim' },
    ],
    lastAssistantMessage: 'Quer que eu te ajude a agendar uma visita?',
    flowState: {},
  });
  assert.equal(context.kind, 'visit_confirmation');
  assert.equal(shouldSuppressVisitFlowForConfirmationKind(context.kind), false);

  const shouldScheduleVisit = isVisitSchedulingIntent({
    userMessage: 'sim',
    flowState: {},
    confirmationContextKind: context.kind,
    resolvedIntent: 'visita_agendamento',
    primaryAxis: 'visita_agendamento',
    currentAxis: 'visita_agendamento',
    requestedAxis: 'visita_agendamento',
    lastAssistantMessage: 'Quer que eu te ajude a agendar uma visita?',
    enterpriseId: 10,
    referenceNow: new Date('2026-05-25T12:00:00.000Z'),
  });
  assert.equal(shouldScheduleVisit, true);
});

test('"sim" apos pergunta de corretor resolve para handoff', () => {
  const recentMessages = [
    { role: 'assistant' as const, content: 'Quer que eu encaminhe para um corretor te passar certinho?' },
    { role: 'user' as const, content: 'sim' },
  ];
  const context = resolveShortConfirmationContext({
    userText: 'sim',
    recentMessages,
    lastAssistantMessage: recentMessages[0].content,
    flowState: {},
  });
  assert.equal(context.kind, 'broker_confirmation');

  const policy = applyAnaConversationPolicy({
    conversationId: 51,
    userMessage: 'sim',
    replyText: 'Perfeito. Posso te ajudar com mais algo?',
    isFirstAnaReply: false,
    flowState: {},
    recentMessages,
    disableFollowupQuestion: true,
    shortConfirmationContext: {
      kind: context.kind,
      lastAssistantQuestionType: context.lastAssistantQuestionType,
      lastAssistantQuestionText: context.lastAssistantQuestionText,
      lastOfferedTopics: context.lastOfferedTopics,
    },
  });
  assert.match(policy.text, /encaminhar para um corretor/i);
});

test('"sim" apos pergunta com dois topicos pede escolha e nao visita', () => {
  const recentMessages = [
    { role: 'assistant' as const, content: 'Quer que eu te fale tambem sobre seguranca ou localizacao?' },
    { role: 'user' as const, content: 'sim' },
  ];
  const context = resolveShortConfirmationContext({
    userText: 'sim',
    recentMessages,
    lastAssistantMessage: recentMessages[0].content,
    flowState: {},
  });
  assert.equal(context.kind, 'followup_topic_confirmation');
  assert.equal(context.lastOfferedTopics.length >= 2, true);

  const policy = applyAnaConversationPolicy({
    conversationId: 52,
    userMessage: 'sim',
    replyText: 'Perfeito. Para qual dia voce prefere agendar a visita?',
    isFirstAnaReply: false,
    flowState: {},
    recentMessages,
    disableFollowupQuestion: true,
    shortConfirmationContext: {
      kind: context.kind,
      lastAssistantQuestionType: context.lastAssistantQuestionType,
      lastAssistantQuestionText: context.lastAssistantQuestionText,
      lastOfferedTopics: context.lastOfferedTopics,
    },
  });
  assert.equal(/agendar|visita/i.test(policy.text), false);
  assert.match(policy.text, /seguran[cç]a|localiza[cç][aã]o|qual dos dois/i);
});

test('quando pendingVisitScheduling esta ativo, confirmacao curta nao desliga fluxo de visita', () => {
  const context = resolveShortConfirmationContext({
    userText: 'sim',
    recentMessages: [
      { role: 'assistant', content: 'Quer que eu te explique as formas de pagamento?' },
      { role: 'user', content: 'sim' },
    ],
    lastAssistantMessage: 'Quer que eu te explique as formas de pagamento?',
    flowState: {
      pendingVisitScheduling: true,
      pendingVisitDateLabel: 'sabado',
      pendingVisitDate: '2026-05-30',
      pendingVisitPeriod: 'manha',
    },
  });
  assert.equal(context.kind, 'followup_topic_confirmation');
  assert.equal(shouldSuppressVisitFlowForConfirmationKind(context.kind), true);

  const directVisitIntent = isVisitSchedulingIntent({
    userMessage: 'sim',
    flowState: {
      pendingVisitScheduling: true,
      pendingVisitDateLabel: 'sabado',
      pendingVisitDate: '2026-05-30',
      pendingVisitPeriod: 'manha',
    },
    confirmationContextKind: context.kind,
    resolvedIntent: 'visita_agendamento',
    primaryAxis: 'visita_agendamento',
    currentAxis: 'visita_agendamento',
    requestedAxis: 'visita_agendamento',
    lastAssistantMessage: 'Quer que eu te explique as formas de pagamento?',
    enterpriseId: 10,
    referenceNow: new Date('2026-05-25T12:00:00.000Z'),
  });
  assert.equal(directVisitIntent, true);

  const visitFlowContextActive = directVisitIntent;
  assert.equal(visitFlowContextActive, true);
});

test('estado ausente reconstrói contexto pela última outbound da Ana', () => {
  const context = resolveShortConfirmationContext({
    userText: 'sim',
    recentMessages: [
      { role: 'assistant', content: 'Quer que eu te explique tambem sobre lazer ou formas de pagamento?' },
      { role: 'user', content: 'sim' },
    ],
    lastAssistantMessage: 'Quer que eu te explique tambem sobre lazer ou formas de pagamento?',
    flowState: {},
  });
  assert.equal(context.source, 'history');
  assert.equal(context.kind, 'followup_topic_confirmation');
  assert.equal(context.lastOfferedTopics.length >= 2, true);
});

test('"vc disse que ia falar mais" recupera topicos pendentes do ultimo follow-up', () => {
  const policy = applyAnaConversationPolicy({
    conversationId: 6,
    userMessage: 'vc disse que ia falar mais',
    replyText: 'Com certeza! Vou detalhar um pouco mais sobre o loteamento Evora.',
    isFirstAnaReply: false,
    flowState: {},
    recentMessages: [
      { role: 'assistant', content: 'Quer que eu te explique tambem sobre lazer ou formas de pagamento?' },
      { role: 'user', content: 'vc disse que ia falar mais' },
    ],
    disableFollowupQuestion: true,
  });

  assert.match(policy.text, /lazer/i);
  assert.match(policy.text, /formas de pagamento|pagamento/i);
  assert.match(policy.text, /qual dos dois voce prefere|qual dos dois você prefere/i);
});

test('"fala mais" sem topico pendente pede direcionamento objetivo', () => {
  const policy = applyAnaConversationPolicy({
    conversationId: 7,
    userMessage: 'fala mais',
    replyText: 'Com certeza! Vou detalhar um pouco mais sobre o empreendimento.',
    isFirstAnaReply: false,
    flowState: {},
    recentMessages: [
      { role: 'assistant', content: 'Perfeito, te passo os detalhes por aqui.' },
      { role: 'user', content: 'fala mais' },
    ],
    disableFollowupQuestion: true,
  });

  assert.equal(/vou detalhar um pouco mais/i.test(policy.text), false);
  assert.match(policy.text, /valores|lazer|localiza|seguran|pagamento/i);
});

test('info gap de lotes pede permissao para corretor e nao troca para infraestrutura', () => {
  const policy = applyAnaConversationPolicy({
    conversationId: 80,
    userMessage: 'o condominio vai ter quantos lotes?',
    replyText: 'Ainda nao tenho essa previsao exata liberada por aqui.',
    isFirstAnaReply: false,
    flowState: {},
    recentMessages: [{ role: 'user', content: 'o condominio vai ter quantos lotes?' }],
    disableFollowupQuestion: false,
  });

  assert.match(policy.text, /ainda nao tenho essa informacao exata liberada por aqui/i);
  assert.match(policy.text, /quer que eu encaminhe para um corretor te passar certinho\?/i);
  assert.equal(/infraestrutura/i.test(policy.text), false);
  assert.equal(/agendar|visita/i.test(policy.text), false);
});
test('apos info gap com corretor, "sim" resolve broker_confirmation e nao visit_confirmation', () => {
  const assistantReply =
    'Ainda nao tenho essa informacao exata liberada por aqui. Quer que eu encaminhe para um corretor te passar certinho?';
  const context = resolveShortConfirmationContext({
    userText: 'sim',
    recentMessages: [
      { role: 'assistant', content: assistantReply },
      { role: 'user', content: 'sim' },
    ],
    lastAssistantMessage: assistantReply,
    flowState: {},
  });

  assert.equal(context.kind, 'broker_confirmation');
  assert.notEqual(context.kind, 'visit_confirmation');

  const visitIntent = isVisitSchedulingIntent({
    userMessage: 'sim',
    flowState: {},
    confirmationContextKind: context.kind,
    resolvedIntent: 'visita_agendamento',
    primaryAxis: 'visita_agendamento',
    currentAxis: 'visita_agendamento',
    requestedAxis: 'visita_agendamento',
    lastAssistantMessage: assistantReply,
    enterpriseId: 10,
    referenceNow: new Date('2026-05-25T12:00:00.000Z'),
  });
  assert.equal(visitIntent, false);
});

test('agendamento rejeita "amanha as 20" e nao avanca para nome', () => {
  const decision = handleVisitSchedulingDeterministically({
    userMessage: 'pode ser amanha as 20?',
    flowState: {
      pendingVisitScheduling: true,
    },
    enterpriseId: 10,
    customerName: null,
    customerPhone: '11999990000',
    referenceNow: new Date('2026-05-25T12:00:00.000Z'),
  });

  assert.equal(decision.reason, 'time_outside_visit_window');
  assert.equal(decision.missingSlot, 'valid_time');
  assert.equal(decision.pendingVisitScheduling, true);
  assert.equal(decision.nextState.pendingVisitTime ?? null, null);
  assert.match(decision.reply ?? '', /fora do hor[áa]rio dispon[íi]vel para visitas/i);
  assert.equal(/como posso te chamar|confirmar sua visita/i.test(decision.reply ?? ''), false);
});

test('apos horario invalido, "20" mantem bloqueio e pede horario valido', () => {
  const first = handleVisitSchedulingDeterministically({
    userMessage: 'amanha as 20',
    flowState: { pendingVisitScheduling: true },
    enterpriseId: 10,
    customerName: null,
    customerPhone: '11999990000',
    referenceNow: new Date('2026-05-25T12:00:00.000Z'),
  });
  const insist = handleVisitSchedulingDeterministically({
    userMessage: '20',
    flowState: first.nextState,
    lastAssistantMessage: first.reply,
    enterpriseId: 10,
    customerName: null,
    customerPhone: '11999990000',
    referenceNow: new Date('2026-05-25T12:05:00.000Z'),
  });

  assert.equal(insist.reason, 'time_outside_visit_window_repeat');
  assert.equal(insist.missingSlot, 'valid_time');
  assert.match(insist.reply ?? '', /20h fica fora do hor[áa]rio de visitas/i);
});

test('apos horario invalido, nome informado nao confirma visita e segue pedindo horario', () => {
  const first = handleVisitSchedulingDeterministically({
    userMessage: 'amanha as 20',
    flowState: { pendingVisitScheduling: true },
    enterpriseId: 10,
    customerName: null,
    customerPhone: '11999990000',
    referenceNow: new Date('2026-05-25T12:00:00.000Z'),
  });
  const afterName = handleVisitSchedulingDeterministically({
    userMessage: 'ulysses',
    flowState: first.nextState,
    lastAssistantMessage: first.reply,
    enterpriseId: 10,
    customerName: null,
    customerPhone: '11999990000',
    referenceNow: new Date('2026-05-25T12:06:00.000Z'),
  });

  assert.equal(afterName.missingSlot, 'valid_time');
  assert.equal(afterName.appointmentConfirmed, false);
  assert.match(afterName.reply ?? '', /s[oó] preciso ajustar o hor[áa]rio/i);
  assert.equal(/confirmar sua visita/i.test(afterName.reply ?? ''), false);
});

test('apos horario invalido, "sim" nao confirma e pede horario entre 09h e 18h', () => {
  const first = handleVisitSchedulingDeterministically({
    userMessage: 'amanha as 20',
    flowState: { pendingVisitScheduling: true },
    enterpriseId: 10,
    customerName: null,
    customerPhone: '11999990000',
    referenceNow: new Date('2026-05-25T12:00:00.000Z'),
  });
  const afterYes = handleVisitSchedulingDeterministically({
    userMessage: 'sim',
    flowState: first.nextState,
    lastAssistantMessage: first.reply,
    enterpriseId: 10,
    customerName: null,
    customerPhone: '11999990000',
    referenceNow: new Date('2026-05-25T12:07:00.000Z'),
  });

  assert.equal(afterYes.missingSlot, 'valid_time');
  assert.equal(afterYes.appointmentConfirmed, false);
  assert.match(afterYes.reply ?? '', /qual hor[áa]rio entre 09h e 18h/i);
});

test('com fluxo de visita ativo e horario invalido, politica nao devolve CTA generico comercial', () => {
  const policy = applyAnaConversationPolicy({
    conversationId: 90,
    userMessage: 'sim',
    replyText: 'Claro. Você quer saber mais sobre valores, lazer, localização, segurança ou formas de pagamento?',
    isFirstAnaReply: false,
    flowState: {
      pendingVisitScheduling: true,
      pendingVisitDateLabel: 'amanha',
      pendingVisitDate: '2026-05-26',
      pendingVisitTime: null,
      pendingVisitInvalidTime: '20h',
      pendingVisitMissingSlot: 'valid_time',
    },
    recentMessages: [
      { role: 'assistant', content: 'Amanhã às 20h fica fora do horário disponível para visitas.' },
      { role: 'user', content: 'sim' },
    ],
    disableFollowupQuestion: true,
    visitFlowActive: true,
  });

  assert.match(policy.text, /09h e 18h/i);
  assert.equal(/valores|lazer|localiza|seguran|formas de pagamento/i.test(policy.text), false);
});

test('mensagem "ue" com horario invalido gera reparo empatico e pede horario valido', () => {
  const first = handleVisitSchedulingDeterministically({
    userMessage: 'amanha as 20',
    flowState: { pendingVisitScheduling: true },
    enterpriseId: 10,
    customerName: null,
    customerPhone: '11999990000',
    referenceNow: new Date('2026-05-25T12:00:00.000Z'),
  });
  const repair = handleVisitSchedulingDeterministically({
    userMessage: 'ue',
    flowState: first.nextState,
    lastAssistantMessage: first.reply,
    enterpriseId: 10,
    customerName: null,
    customerPhone: '11999990000',
    referenceNow: new Date('2026-05-25T12:08:00.000Z'),
  });

  assert.equal(repair.reason, 'invalid_time_pending_confusion_repair');
  assert.match(repair.reply ?? '', /voce tem raz[aã]o|você tem razão/i);
  assert.match(repair.reply ?? '', /09h e 18h/i);
});

test('apos horario invalido, horario valido avanca para captura de nome', () => {
  const first = handleVisitSchedulingDeterministically({
    userMessage: 'amanha as 20',
    flowState: { pendingVisitScheduling: true },
    enterpriseId: 10,
    customerName: null,
    customerPhone: '11999990000',
    referenceNow: new Date('2026-05-25T12:00:00.000Z'),
  });
  const valid = handleVisitSchedulingDeterministically({
    userMessage: 'amanha as 10',
    flowState: first.nextState,
    lastAssistantMessage: first.reply,
    enterpriseId: 10,
    customerName: null,
    customerPhone: '11999990000',
    referenceNow: new Date('2026-05-25T12:09:00.000Z'),
  });

  assert.equal(valid.reason, 'date_time_without_name');
  assert.equal(valid.missingSlot, 'nome');
  assert.equal(valid.nextState.pendingVisitInvalidTime ?? null, null);
});

test('todos os slots validos com "sim" confirmam agendamento', () => {
  const confirm = handleVisitSchedulingDeterministically({
    userMessage: 'sim',
    flowState: {
      pendingVisitScheduling: true,
      pendingVisitDateLabel: 'amanha',
      pendingVisitDate: '2026-05-26',
      pendingVisitTime: '10:00',
      pendingVisitPeriod: null,
      pendingVisitInvalidTime: null,
      pendingVisitMissingSlot: null,
      pendingVisitCustomerName: 'Ulysses',
      pendingVisitConfirmationAsked: true,
    },
    enterpriseId: 10,
    customerName: 'Ulysses',
    customerPhone: '11999990000',
    referenceNow: new Date('2026-05-25T12:10:00.000Z'),
  });

  assert.equal(confirm.appointmentConfirmed, true);
  assert.equal(confirm.missingSlot, null);
  assert.match(confirm.reply ?? '', /visita ficou agendada/i);
});

test('confirmacao curta no fluxo completo continua funcionando', () => {
  const started = handleVisitSchedulingDeterministically({
    userMessage: 'Quero marcar uma visita.',
    flowState: {},
    enterpriseId: 10,
    customerName: null,
    customerPhone: '11999990000',
    referenceNow: new Date('2026-05-25T10:00:00.000Z'),
  });
  assert.equal(started.nextState.pendingVisitScheduling, true);

  const withDateTime = handleVisitSchedulingDeterministically({
    userMessage: 'Hoje às 15h.',
    flowState: started.nextState,
    lastAssistantMessage: started.reply,
    enterpriseId: 10,
    customerName: null,
    customerPhone: '11999990000',
    referenceNow: new Date('2026-05-25T10:01:00.000Z'),
  });
  assert.equal(withDateTime.missingSlot, 'nome');

  const withName = handleVisitSchedulingDeterministically({
    userMessage: 'Ulysses.',
    flowState: withDateTime.nextState,
    lastAssistantMessage: withDateTime.reply,
    enterpriseId: 10,
    customerName: null,
    customerPhone: '11999990000',
    referenceNow: new Date('2026-05-25T10:02:00.000Z'),
  });
  assert.equal(withName.missingSlot, null);
  assert.match(withName.reply ?? '', /posso confirmar sua visita/i);

  const confirmed = handleVisitSchedulingDeterministically({
    userMessage: 'Sim.',
    flowState: withName.nextState,
    lastAssistantMessage: withName.reply,
    enterpriseId: 10,
    customerName: null,
    customerPhone: '11999990000',
    referenceNow: new Date('2026-05-25T10:03:00.000Z'),
  });
  assert.equal(confirmed.appointmentConfirmed, true);
  assert.equal(confirmed.nextState.pendingVisitScheduling, false);
  assert.equal(confirmed.nextState.pendingVisitConfirmationAsked, false);
  assert.match(confirmed.reply ?? '', /visita ficou agendada/i);
});

test('confirmacao natural "Sim, pode confirmar." conclui agendamento', () => {
  const withDateTime = handleVisitSchedulingDeterministically({
    userMessage: 'Pode agendar para amanha as 10h?',
    flowState: {
      pendingVisitScheduling: true,
    },
    enterpriseId: 10,
    customerName: null,
    customerPhone: '11999990000',
    referenceNow: new Date('2026-05-25T11:00:00.000Z'),
  });
  assert.equal(withDateTime.missingSlot, 'nome');

  const withName = handleVisitSchedulingDeterministically({
    userMessage: 'Meu nome e Ulysses Lima.',
    flowState: withDateTime.nextState,
    lastAssistantMessage: withDateTime.reply,
    enterpriseId: 10,
    customerName: null,
    customerPhone: '11999990000',
    referenceNow: new Date('2026-05-25T11:01:00.000Z'),
  });
  assert.equal(withName.missingSlot, null);
  assert.match(withName.reply ?? '', /posso confirmar sua visita/i);

  const confirmed = handleVisitSchedulingDeterministically({
    userMessage: 'Sim, pode confirmar.',
    flowState: withName.nextState,
    lastAssistantMessage: withName.reply,
    enterpriseId: 10,
    customerName: null,
    customerPhone: '11999990000',
    referenceNow: new Date('2026-05-25T11:02:00.000Z'),
  });
  assert.equal(confirmed.appointmentConfirmed, true);
  assert.equal(confirmed.nextState.pendingVisitScheduling, false);
  assert.equal(confirmed.nextState.pendingVisitConfirmationAsked, false);
  assert.equal(confirmed.capturedSlots.includes('nome'), true);
  assert.equal(confirmed.reason, 'date_and_time_confirmed');
  assert.match(confirmed.reply ?? '', /visita ficou agendada/i);
  assert.equal(/posso confirmar sua visita/i.test(confirmed.reply ?? ''), false);
});

test('variacoes naturais de confirmacao concluem quando pendingConfirmationAsked=true', () => {
  const flowState = {
    pendingVisitScheduling: true,
    pendingVisitDateLabel: 'amanha',
    pendingVisitDate: '2026-05-26',
    pendingVisitTime: '10:00',
    pendingVisitPeriod: null,
    pendingVisitInvalidTime: null,
    pendingVisitMissingSlot: null,
    pendingVisitCustomerName: 'Ulysses Lima',
    pendingVisitConfirmationAsked: true,
  };
  const variants = ['Pode confirmar.', 'Confirmo.', 'Confirmado.'];
  for (const message of variants) {
    assert.equal(isVisitSchedulingConfirmationMessage(message), true);
    const result = handleVisitSchedulingDeterministically({
      userMessage: message,
      flowState,
      enterpriseId: 10,
      customerName: null,
      customerPhone: '11999990000',
      referenceNow: new Date('2026-05-25T11:05:00.000Z'),
    });
    assert.equal(result.appointmentConfirmed, true);
    assert.equal(result.nextState.pendingVisitScheduling, false);
    assert.equal(result.nextState.pendingVisitConfirmationAsked, false);
    assert.equal(result.reason, 'date_and_time_confirmed');
  }
});

test('fluxo completo de visita confirma sem reabrir coleta de slots', () => {
  const afterDateTime = handleVisitSchedulingDeterministically({
    userMessage: 'Hoje às 15',
    flowState: {
      pendingVisitScheduling: true,
    },
    enterpriseId: 10,
    customerName: null,
    customerPhone: '11999990000',
    referenceNow: new Date('2026-05-25T12:10:00.000Z'),
  });
  assert.equal(afterDateTime.appointmentConfirmed, false);
  assert.equal(afterDateTime.missingSlot, 'nome');
  assert.match(afterDateTime.reply ?? '', /como posso te chamar|me passa seu nome/i);

  const afterName = handleVisitSchedulingDeterministically({
    userMessage: 'Ulysses',
    flowState: afterDateTime.nextState,
    lastAssistantMessage: afterDateTime.reply,
    enterpriseId: 10,
    customerName: null,
    customerPhone: '11999990000',
    referenceNow: new Date('2026-05-25T12:11:00.000Z'),
  });
  assert.equal(afterName.appointmentConfirmed, false);
  assert.equal(afterName.missingSlot, null);
  assert.match(afterName.reply ?? '', /posso confirmar sua visita/i);

  const confirmed = handleVisitSchedulingDeterministically({
    userMessage: 'Sim',
    flowState: afterName.nextState,
    lastAssistantMessage: afterName.reply,
    enterpriseId: 10,
    customerName: null,
    customerPhone: '11999990000',
    referenceNow: new Date('2026-05-25T12:12:00.000Z'),
  });
  assert.equal(confirmed.appointmentConfirmed, true);
  assert.equal(confirmed.nextState.pendingVisitScheduling, false);
  assert.match(confirmed.reply ?? '', /visita ficou agendada/i);
  assert.equal(/para qual dia/i.test(confirmed.reply ?? ''), false);
  assert.equal(/posso confirmar sua visita/i.test(confirmed.reply ?? ''), false);
});

test('apos scheduled, mensagem de pagamento nao ativa intencao de visita', () => {
  const intent = isVisitSchedulingIntent({
    userMessage: 'Agora me fala das condicoes de pagamento.',
    flowState: {
      pendingVisitScheduling: false,
      visitScheduling: {
        active: false,
        offered: true,
        accepted: true,
        requestedDateText: 'amanha',
        requestedTimeText: '10h',
        requestedPeriodText: null,
        normalizedDate: '2026-05-26',
        normalizedTime: '10:00',
        nameCollected: true,
        customerName: 'Ulysses Lima',
        status: 'scheduled',
      },
    },
    confirmationContextKind: 'not_short_confirmation',
    resolvedIntent: null,
    primaryAxis: null,
    currentAxis: null,
    requestedAxis: null,
    lastAssistantMessage: 'Perfeito, sua visita ficou agendada para amanha as 10h.',
    enterpriseId: 10,
    referenceNow: new Date('2026-05-25T11:10:00.000Z'),
  });
  assert.equal(intent, false);
});

test('quando visita ja esta scheduled, policy nao ancora novamente em coleta de visita', () => {
  const policy = applyAnaConversationPolicy({
    conversationId: 601,
    userMessage: 'o valor parcela?',
    replyText: 'Perfeito. Visita agendada. Se quiser, tambem posso te ajudar com valores e pagamento.',
    isFirstAnaReply: false,
    flowState: {
      pendingVisitScheduling: false,
      visitScheduling: {
        active: false,
        offered: true,
        accepted: true,
        requestedDateText: 'hoje',
        requestedTimeText: '15h',
        requestedPeriodText: null,
        normalizedDate: '2026-05-25',
        normalizedTime: '15:00',
        nameCollected: true,
        customerName: 'Ulysses',
        status: 'scheduled',
      },
    },
    recentMessages: [
      { role: 'assistant', content: 'Perfeito. Sua visita ficou agendada para hoje às 15h.' },
      { role: 'user', content: 'o valor parcela?' },
    ],
    disableFollowupQuestion: true,
    visitFlowActive: true,
  });
  assert.equal(/para qual dia|qual hor[aá]rio|posso confirmar sua visita/i.test(policy.text), false);
  assert.match(policy.text, /visita agendada|valores|pagamento/i);
});

test('quando pendingVisitScheduling esta ativo e usuario muda para valor/parcela, fluxo de visita nao deve ligar', () => {
  assert.equal(isVisitSchedulingTopicSwitchMessage('o valor parcela?'), true);
  assert.equal(isVisitSchedulingTopicSwitchMessage('tem lazer?'), true);
  const intent = isVisitSchedulingIntent({
    userMessage: 'o valor parcela?',
    flowState: {
      pendingVisitScheduling: true,
      pendingVisitDateLabel: 'amanha',
      pendingVisitDate: '2026-05-26',
      pendingVisitTime: null,
      pendingVisitInvalidTime: '20h',
      pendingVisitMissingSlot: 'valid_time',
    },
    confirmationContextKind: 'not_short_confirmation',
    resolvedIntent: null,
    primaryAxis: null,
    currentAxis: null,
    requestedAxis: null,
    lastAssistantMessage: '20h fica fora do horario de visitas. Posso seguir com um horario entre 09h e 18h. Qual prefere?',
    enterpriseId: 10,
    referenceNow: new Date('2026-05-25T12:11:00.000Z'),
  });
  assert.equal(intent, false);
  const lazerIntent = isVisitSchedulingIntent({
    userMessage: 'tem lazer?',
    flowState: {
      pendingVisitScheduling: true,
      pendingVisitDateLabel: 'amanha',
      pendingVisitDate: '2026-05-26',
      pendingVisitTime: null,
      pendingVisitInvalidTime: '20h',
      pendingVisitMissingSlot: 'valid_time',
    },
    confirmationContextKind: 'not_short_confirmation',
    resolvedIntent: null,
    primaryAxis: null,
    currentAxis: null,
    requestedAxis: null,
    lastAssistantMessage: '20h fica fora do horario de visitas. Posso seguir com um horario entre 09h e 18h. Qual prefere?',
    enterpriseId: 10,
    referenceNow: new Date('2026-05-25T12:11:00.000Z'),
  });
  assert.equal(lazerIntent, false);
});

test('quando pendingVisitScheduling esta ativo e usuario informa slot, fluxo de visita segue normal', () => {
  const intent = isVisitSchedulingIntent({
    userMessage: 'amanha as 10',
    flowState: {
      pendingVisitScheduling: true,
      pendingVisitDateLabel: 'amanha',
      pendingVisitDate: '2026-05-26',
      pendingVisitTime: null,
      pendingVisitInvalidTime: '20h',
      pendingVisitMissingSlot: 'valid_time',
    },
    confirmationContextKind: 'not_short_confirmation',
    resolvedIntent: null,
    primaryAxis: null,
    currentAxis: null,
    requestedAxis: null,
    lastAssistantMessage: '20h fica fora do horario de visitas. Posso seguir com um horario entre 09h e 18h. Qual prefere?',
    enterpriseId: 10,
    referenceNow: new Date('2026-05-25T12:11:00.000Z'),
  });
  assert.equal(intent, true);
});

test('comercial: "qual o valor?" responde valor inicial e metro quadrado', () => {
  const rule = resolveAnaCommercialRule({
    enterpriseName: 'Évora',
    userMessage: 'qual o valor?',
    isFirstAnaReply: false,
    previousAssistantMessage: null,
  });
  const text = (rule?.messages ?? []).join(' ');
  assert.equal(rule?.ruleId, 'preco_valor_lote');
  assert.match(text, /R\$279\.000,00/);
  assert.match(text, /R\$775,00/);
});

test('comercial: "parcela?" não repete valor inicial e oferece corretor para simulação', () => {
  const rule = resolveAnaCommercialRule({
    enterpriseName: 'Évora',
    userMessage: 'parcela?',
    isFirstAnaReply: false,
    previousAssistantMessage: 'O valor inicial do Évora é a partir de R$279.000,00...',
  });
  const text = (rule?.messages ?? []).join(' ');
  assert.equal(rule?.ruleId, 'parcela_simulacao');
  assert.equal(/R\$279\.000,00/.test(text), false);
  assert.match(text, /encaminhe para um corretor/i);
  assert.equal((text.match(/\?/g) ?? []).length, 1);
  assert.equal(/agendar|visita/i.test(text), false);
});

test('comercial: "formas de pagamento" responde 120x, 48x e financiamento direto', () => {
  const rule = resolveAnaCommercialRule({
    enterpriseName: 'Évora',
    userMessage: 'formas de pagamento',
    isFirstAnaReply: false,
    previousAssistantMessage: null,
  });
  const text = (rule?.messages ?? []).join(' ');
  assert.equal(rule?.ruleId, 'formas_pagamento');
  assert.match(text, /120x/);
  assert.match(text, /48x/);
  assert.match(text, /financiamento pode ser direto com a construtora/i);
});

test('estado false + historico de horario invalido e nome reconstrui fluxo ativo com valid_time', () => {
  const reconstructed = reconstructVisitStateFromRecentMessages({
    flowState: {
      pendingVisitScheduling: false,
    },
    enterpriseId: 10,
    knownCustomerName: null,
    referenceNow: new Date('2026-05-25T12:12:00.000Z'),
    recentMessages: [
      { role: 'assistant', content: 'Perfeito, amanhã. Qual horário fica melhor para você? Temos disponibilidade de segunda a sábado, das 09h às 18h.' },
      { role: 'user', content: 'pode ser amanhã às 20?' },
      { role: 'assistant', content: 'Amanhã às 20h fica fora do horário disponível para visitas. Qual horário entre 09h e 18h você prefere?' },
      { role: 'user', content: '20' },
      { role: 'assistant', content: 'Obrigado. Como posso te chamar para confirmar o agendamento?' },
      { role: 'user', content: 'ulysses' },
    ],
  });

  assert.equal(reconstructed.reconstructed, true);
  assert.equal(reconstructed.nextState.pendingVisitScheduling, true);
  assert.equal(reconstructed.nextState.pendingVisitMissingSlot, 'valid_time');
  assert.equal(reconstructed.nextState.pendingVisitInvalidTime, '20h');
  assert.equal(reconstructed.nextState.pendingVisitCustomerName, 'Ulysses');
});

test('estado false + historico com pergunta de nome reconstrui visita ativa', () => {
  const reconstructed = reconstructVisitStateFromRecentMessages({
    flowState: {
      pendingVisitScheduling: false,
    },
    enterpriseId: 10,
    referenceNow: new Date('2026-05-25T12:13:00.000Z'),
    recentMessages: [
      { role: 'assistant', content: 'Perfeito, amanhã às 10h. Como posso te chamar para confirmar o agendamento?' },
      { role: 'user', content: 'ulysses' },
    ],
  });

  assert.equal(reconstructed.reconstructed, true);
  assert.equal(reconstructed.nextState.pendingVisitScheduling, true);
  assert.equal(reconstructed.nextState.pendingVisitCustomerName, 'Ulysses');
  assert.equal(reconstructed.nextState.pendingVisitConfirmationAsked, false);
});

test('estado false + historico de confirmacao so confirma com slots validos', () => {
  const reconstructed = reconstructVisitStateFromRecentMessages({
    flowState: {
      pendingVisitScheduling: false,
    },
    enterpriseId: 10,
    referenceNow: new Date('2026-05-25T12:14:00.000Z'),
    recentMessages: [
      { role: 'assistant', content: 'Perfeito. Posso confirmar sua visita para amanhã às 10h?' },
      { role: 'user', content: 'sim' },
    ],
  });

  assert.equal(reconstructed.reconstructed, true);
  const decision = handleVisitSchedulingDeterministically({
    userMessage: 'sim',
    flowState: reconstructed.nextState,
    customerName: 'Ulysses',
    customerPhone: '11999990000',
    enterpriseId: 10,
    referenceNow: new Date('2026-05-25T12:14:30.000Z'),
  });
  assert.equal(decision.appointmentConfirmed, true);
});

test('estado false + historico invalido + "sim" continua pedindo horario valido', () => {
  const reconstructed = reconstructVisitStateFromRecentMessages({
    flowState: {
      pendingVisitScheduling: false,
    },
    enterpriseId: 10,
    referenceNow: new Date('2026-05-25T12:15:00.000Z'),
    recentMessages: [
      { role: 'assistant', content: 'Amanhã às 20h fica fora do horário disponível para visitas. Qual horário entre 09h e 18h você prefere?' },
      { role: 'user', content: 'sim' },
    ],
  });

  assert.equal(reconstructed.reconstructed, true);
  const decision = handleVisitSchedulingDeterministically({
    userMessage: 'sim',
    flowState: reconstructed.nextState,
    customerName: null,
    customerPhone: '11999990000',
    enterpriseId: 10,
    referenceNow: new Date('2026-05-25T12:15:30.000Z'),
  });
  assert.equal(decision.appointmentConfirmed, false);
  assert.equal(decision.missingSlot, 'valid_time');
  assert.match(decision.reply ?? '', /09h e 18h/i);
});

test('reconstrucao ativa mantem lock de fluxo e bypass de caminho aberto', () => {
  const reconstructed = reconstructVisitStateFromRecentMessages({
    flowState: {
      pendingVisitScheduling: false,
    },
    enterpriseId: 10,
    referenceNow: new Date('2026-05-25T12:16:00.000Z'),
    recentMessages: [
      { role: 'assistant', content: 'Perfeito, sábado de manhã. Qual horário fica melhor para você?' },
      { role: 'user', content: 'ok' },
    ],
  });
  assert.equal(reconstructed.reconstructed, true);

  const visitIntent = isVisitSchedulingIntent({
    userMessage: 'ok',
    flowState: reconstructed.nextState,
    confirmationContextKind: 'followup_topic_confirmation',
    resolvedIntent: null,
    primaryAxis: null,
    currentAxis: null,
    requestedAxis: null,
    lastAssistantMessage: 'Perfeito, sábado de manhã. Qual horário fica melhor para você?',
    enterpriseId: 10,
    referenceNow: new Date('2026-05-25T12:16:30.000Z'),
  });
  assert.equal(visitIntent, true);
});

test('nome ja informado no estado nao e perguntado novamente', () => {
  const decision = handleVisitSchedulingDeterministically({
    userMessage: 'ok',
    flowState: {
      pendingVisitScheduling: true,
      pendingVisitDateLabel: 'amanha',
      pendingVisitDate: '2026-05-26',
      pendingVisitTime: '10:00',
      pendingVisitPeriod: null,
      pendingVisitInvalidTime: null,
      pendingVisitMissingSlot: null,
      pendingVisitCustomerName: 'Ulysses',
      pendingVisitConfirmationAsked: false,
    },
    enterpriseId: 10,
    customerName: null,
    customerPhone: '11999990000',
    referenceNow: new Date('2026-05-25T12:17:00.000Z'),
  });

  assert.equal(decision.missingSlot, null);
  assert.equal(/como posso te chamar|seu nome/i.test(decision.reply ?? ''), false);
  assert.match(decision.reply ?? '', /posso confirmar sua visita/i);
});

test('resposta de localizacao nao termina com duas perguntas', () => {
  const policy = applyAnaConversationPolicy({
    conversationId: 120,
    userMessage: 'onde fica?',
    replyText:
      'Evora fica em Atibaia, com acesso pela Rodovia Dom Pedro I. Me conta, quais sao suas duvidas? Vou responder todas. Quer saber tambem sobre valores ou areas de lazer?',
    isFirstAnaReply: false,
    flowState: {},
    recentMessages: [{ role: 'user', content: 'onde fica?' }],
    disableFollowupQuestion: true,
    safeTopicAvailability: {
      localizacao: true,
      valores: true,
      lazer: true,
      seguranca: true,
      pagamento: true,
    },
  });

  const questions = (policy.text.match(/\?/g) || []).length;
  assert.equal(questions <= 1, true);
  assert.equal(/quais sao suas duvidas/i.test(policy.text), false);
});

test('remove pergunta generica quando ja existe pergunta especifica', () => {
  const policy = applyAnaConversationPolicy({
    conversationId: 121,
    userMessage: 'quero localizacao',
    replyText:
      'Fica em Atibaia. Me conta, quais sao suas duvidas? Vou responder todas. Quer saber tambem sobre valores?',
    isFirstAnaReply: false,
    flowState: {},
    recentMessages: [{ role: 'user', content: 'quero localizacao' }],
    disableFollowupQuestion: true,
    safeTopicAvailability: {
      valores: true,
      localizacao: true,
      lazer: true,
      seguranca: true,
      pagamento: true,
    },
  });

  assert.equal(/me conta,\s*quais sao suas duvidas/i.test(policy.text), false);
  assert.match(policy.text, /rodovia dom pedro i|regiao da pedreira/i);
  assert.equal(/quer saber tambem sobre valores\?/i.test(policy.text), false);
});
test('nao oferece topico sem base autorizada', () => {
  const policy = applyAnaConversationPolicy({
    conversationId: 122,
    userMessage: 'ok',
    replyText: 'Quer saber tambem sobre valores?',
    isFirstAnaReply: false,
    flowState: {},
    recentMessages: [{ role: 'assistant', content: 'Posso te explicar localizacao.' }],
    disableFollowupQuestion: true,
    safeTopicAvailability: {
      valores: false,
      localizacao: true,
      lazer: true,
      seguranca: true,
      pagamento: true,
    },
  });

  assert.equal(/valores/i.test(policy.text), false);
  assert.equal(/tem algum ponto especifico|me conta,\s*qual ponto/i.test(policy.text), false);
  assert.match(policy.text, /visita|corretor|morar|investir|construir/i);
});

test('selectSingleSafeNextTopic escolhe apenas um topico seguro', () => {
  const selected = selectSingleSafeNextTopic({
    currentTopic: 'localizacao',
    recentlyDiscussedTopics: ['lazer', 'seguranca', 'localizacao', 'valores'],
    recentlyAskedTopics: ['lazer', 'seguranca', 'localizacao'],
    recentAssistantReplies: [],
    allowedTopics: {
      valores: false,
      pagamento: true,
      localizacao: true,
      lazer: true,
      seguranca: true,
    },
  });

  assert.equal(selected.topic, 'pagamento');
  assert.match(selected.question ?? '', /formas de pagamento/i);
  assert.equal(/\bou\b/i.test(selected.question ?? ''), false);
});

test('selectAnaNextFollowupQuestion sem proximo topico seguro retorna null sem fallback generico', () => {
  const selected = selectAnaNextFollowupQuestion({
    currentTopic: 'localizacao',
    recentlyDiscussedTopics: ['valores', 'pagamento', 'lazer', 'seguranca'],
    recentlyAskedTopics: ['valores', 'pagamento', 'lazer', 'seguranca'],
    recentAssistantReplies: [
      'Quer saber tambem sobre valores?',
      'Quer que eu te explique as formas de pagamento?',
      'Quer que eu te explique as areas de lazer?',
      'Quer que eu te explique a seguranca do empreendimento?',
    ],
    allowedTopics: {
      valores: true,
      pagamento: true,
      localizacao: true,
      lazer: true,
      seguranca: true,
    },
  });

  assert.equal(selected.question, null);
  assert.equal(selected.usedFallbackQuestion, false);
  assert.equal(selected.suppressedByRepeat, true);
});

test('guard final remove frase generica e responde localizacao de forma objetiva', () => {
  const policy = applyAnaConversationPolicy({
    conversationId: 12351,
    userMessage: 'manda a localizacao pfv',
    replyText: 'Tem algum ponto específico que você quer que eu detalhe melhor?',
    isFirstAnaReply: false,
    flowState: {},
    recentMessages: [{ role: 'user', content: 'manda a localizacao pfv' }],
    disableFollowupQuestion: true,
  });

  const normalized = policy.text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  assert.equal(/tem algum ponto especifico|detalhe melhor/.test(normalized), false);
  assert.match(normalized, /atibaia|pedreira|rodovia dom pedro i/);
});

test('guard final remove "me conta, qual ponto..." quando a frase ja foi usada', () => {
  const policy = applyAnaConversationPolicy({
    conversationId: 12352,
    userMessage: 'nao entendi onde fica',
    replyText: 'Me conta, qual ponto você quer entender primeiro?',
    isFirstAnaReply: false,
    flowState: {},
    recentMessages: [
      { role: 'assistant', content: 'Me conta, qual ponto você quer entender primeiro?' },
      { role: 'user', content: 'nao entendi onde fica' },
    ],
    disableFollowupQuestion: true,
  });

  const normalized = policy.text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  assert.equal(/me conta,?\s*qual ponto voce quer entender primeiro/.test(normalized), false);
  assert.match(normalized, /atibaia|pedreira|rodovia dom pedro i/);
});

test('apos envio de fotos, prepara follow-up com "o que achou"', () => {
  const decision = __testOnlyResolveMediaPostSendFollowup({
    flowState: {},
    mediaKind: 'image',
    mediaCategory: 'outro',
    mediaFileName: 'galeria-evora.jpg',
    recentAssistantReplies: [],
  });

  assert.equal(decision.shouldSend, true);
  assert.match(decision.text, /fotos do empreendimento/i);
  assert.match(decision.text, /o que achou\?/i);
});

test('aceite explicito de visita e reconhecido', () => {
  assert.equal(isExplicitVisitSchedulingAcceptance('quero agendar uma visita'), true);
  assert.equal(isExplicitVisitSchedulingAcceptance('pode ser a visita'), true);
  assert.equal(isExplicitVisitSchedulingAcceptance('quero visitar'), true);
});

test('pergunta comercial de metragem deve bypass de agendamento', () => {
  assert.equal(
    isCommercialQuestionThatShouldBypassVisitScheduling('Vi que tem lotes a partir de 300 m². Quais os tamanhos?'),
    true
  );
  assert.equal(isExplicitVisitSchedulingAcceptance('Vi que tem lotes a partir de 300 m². Quais os tamanhos?'), false);
});

test('isVisitSchedulingIntent nao captura pergunta comercial sem aceite explicito', () => {
  const shouldSchedule = isVisitSchedulingIntent({
    userMessage: 'qual o tamanho do lote?',
    flowState: {
      pendingVisitScheduling: true,
      visitScheduling: {
        active: true,
        accepted: false,
        offered: true,
        requestedDateText: null,
        requestedTimeText: null,
        requestedPeriodText: null,
        normalizedDate: null,
        normalizedTime: null,
        nameCollected: false,
        customerName: null,
        status: 'none',
      },
    },
    lastAssistantMessage: 'Se preferir, posso te ajudar a agendar uma visita.',
    enterpriseId: 1,
  });
  assert.equal(shouldSchedule, false);
});

test('reconstrucao de visita nao ativa estado com oferta da Ana sem aceite do cliente', () => {
  const result = reconstructVisitStateFromRecentMessages({
    flowState: {},
    recentMessages: [
      { role: 'assistant', content: 'Se preferir, posso te ajudar a agendar uma visita.' },
      { role: 'user', content: 'qual o tamanho do lote?' },
    ],
    enterpriseId: 1,
  });
  assert.equal(result.reconstructed, false);
  assert.equal(result.reason, 'assistant_offer_without_user_acceptance');
});

test('caso 1: pergunta comercial bypassa visita mesmo com accepted=true ativo', () => {
  const commercialQuestionThisTurn = isCommercialQuestionThatShouldBypassVisitScheduling('qual o tamanho do lote?');
  const explicitVisitSchedulingAcceptanceThisTurn = isExplicitVisitSchedulingAcceptance('qual o tamanho do lote?');
  const visitSchedulingSlotAnswerThisTurn = isVisitSchedulingSlotAnswer({
    userMessage: 'qual o tamanho do lote?',
    flowState: {
      pendingVisitScheduling: false,
      visitScheduling: {
        active: true,
        accepted: true,
        offered: true,
        requestedDateText: null,
        requestedTimeText: null,
        requestedPeriodText: null,
        normalizedDate: null,
        normalizedTime: null,
        nameCollected: false,
        customerName: null,
        status: 'none',
      },
    },
    lastAssistantMessage: 'Perfeito. Para qual dia você prefere agendar a visita?',
  });
  const shouldBypassVisitSchedulingForCommercialQuestion =
    commercialQuestionThisTurn &&
    !explicitVisitSchedulingAcceptanceThisTurn &&
    !visitSchedulingSlotAnswerThisTurn;

  assert.equal(shouldBypassVisitSchedulingForCommercialQuestion, true);
});

test('caso 2: resposta de slot com pending=true nao bypassa visita', () => {
  const commercialQuestionThisTurn = isCommercialQuestionThatShouldBypassVisitScheduling('amanhã às 10h');
  const explicitVisitSchedulingAcceptanceThisTurn = isExplicitVisitSchedulingAcceptance('amanhã às 10h');
  const visitSchedulingSlotAnswerThisTurn = isVisitSchedulingSlotAnswer({
    userMessage: 'amanhã às 10h',
    flowState: {
      pendingVisitScheduling: true,
      pendingVisitMissingSlot: 'periodo_ou_horario',
      visitScheduling: {
        active: true,
        accepted: true,
        offered: true,
        requestedDateText: null,
        requestedTimeText: null,
        requestedPeriodText: null,
        normalizedDate: null,
        normalizedTime: null,
        nameCollected: false,
        customerName: null,
        status: 'none',
      },
    },
    lastAssistantMessage: 'Perfeito, amanhã. Qual horário fica melhor para você?',
  });
  const shouldBypassVisitSchedulingForCommercialQuestion =
    commercialQuestionThisTurn &&
    !explicitVisitSchedulingAcceptanceThisTurn &&
    !visitSchedulingSlotAnswerThisTurn;

  assert.equal(shouldBypassVisitSchedulingForCommercialQuestion, false);
});

test('caso 3: pergunta comercial com pending=true bypassa visita', () => {
  const commercialQuestionThisTurn = isCommercialQuestionThatShouldBypassVisitScheduling('tem câmera?');
  const explicitVisitSchedulingAcceptanceThisTurn = isExplicitVisitSchedulingAcceptance('tem câmera?');
  const visitSchedulingSlotAnswerThisTurn = isVisitSchedulingSlotAnswer({
    userMessage: 'tem câmera?',
    flowState: {
      pendingVisitScheduling: true,
      pendingVisitMissingSlot: 'periodo_ou_horario',
      visitScheduling: {
        active: true,
        accepted: true,
        offered: true,
        requestedDateText: null,
        requestedTimeText: null,
        requestedPeriodText: null,
        normalizedDate: null,
        normalizedTime: null,
        nameCollected: false,
        customerName: null,
        status: 'none',
      },
    },
    lastAssistantMessage: 'Perfeito. Qual horário você prefere para a visita?',
  });
  const shouldBypassVisitSchedulingForCommercialQuestion =
    commercialQuestionThisTurn &&
    !explicitVisitSchedulingAcceptanceThisTurn &&
    !visitSchedulingSlotAnswerThisTurn;

  assert.equal(shouldBypassVisitSchedulingForCommercialQuestion, true);
});

test('caso 4: aceite explícito entra no fluxo de visita', () => {
  assert.equal(isExplicitVisitSchedulingAcceptance('quero agendar uma visita'), true);
  const slotAnswer = isVisitSchedulingSlotAnswer({
    userMessage: 'quero agendar uma visita',
    flowState: {},
    lastAssistantMessage: null,
  });
  assert.equal(slotAnswer, true);
});

test('apos envio de video, prepara follow-up com "o que achou"', () => {
  const decision = __testOnlyResolveMediaPostSendFollowup({
    flowState: {},
    mediaKind: 'video',
    mediaCategory: 'outro',
    mediaFileName: 'tour-evora.mp4',
    recentAssistantReplies: [],
  });

  assert.equal(decision.shouldSend, true);
  assert.match(decision.text, /video do empreendimento/i);
  assert.match(decision.text, /o que achou\?/i);
});

test('nao envia follow-up pos-midia durante fluxo de visita', () => {
  const decision = __testOnlyResolveMediaPostSendFollowup({
    flowState: {
      pendingVisitScheduling: true,
      pendingVisitDateLabel: 'amanha',
      pendingVisitDate: '2026-05-26',
    },
    mediaKind: 'image',
    mediaCategory: 'outro',
    mediaFileName: 'fotos-evora.jpg',
    recentAssistantReplies: [],
  });

  assert.equal(decision.shouldSend, false);
  assert.equal(decision.reason, 'visit_flow');
});

test('nao repete follow-up pos-midia quando ja houve envio recente equivalente', () => {
  const decision = __testOnlyResolveMediaPostSendFollowup({
    flowState: {},
    mediaKind: 'video',
    mediaCategory: 'outro',
    mediaFileName: 'video-evora.mp4',
    recentAssistantReplies: [
      'Te enviei o video do empreendimento. O que achou?',
    ],
  });

  assert.equal(decision.shouldSend, false);
  assert.equal(decision.reason, 'repeat');
});





test('resolveRequestedTopicAction classifica pedido direto de topico', () => {
  const action = resolveRequestedTopicAction({
    userMessage: 'e a seguranca?',
    replyText: 'Quer que eu te explique a seguranca do empreendimento?',
    lastAssistantQuestionContext: {
      questionType: 'other',
      offeredTopics: [],
      questionText: null,
      askedVisitOffer: false,
      askedBrokerHandoff: false,
      askedFollowupTopics: false,
    },
  });

  assert.equal(action.type, 'direct_topic_request');
  assert.equal(action.topic, 'seguranca');
});

test('resolveRequestedTopicAction classifica aceite de oferta de topico', () => {
  const action = resolveRequestedTopicAction({
    userMessage: 'sim',
    replyText: 'Claro. Quer que eu te explique mais sobre seguranca?',
    lastAssistantQuestionContext: {
      questionType: 'followup_topic',
      offeredTopics: ['seguranca'],
      questionText: 'Quer que eu te explique a seguranca do empreendimento?',
      askedVisitOffer: false,
      askedBrokerHandoff: false,
      askedFollowupTopics: true,
    },
  });

  assert.equal(action.type, 'accepted_topic_offer');
  assert.equal(action.topic, 'seguranca');
});

test('resolveRequestedTopicAction classifica follow-up ambiguo com dois topicos', () => {
  const action = resolveRequestedTopicAction({
    userMessage: 'sim',
    replyText: 'Claro. Quer que eu te explique mais sobre seguranca?',
    lastAssistantQuestionContext: {
      questionType: 'followup_topics',
      offeredTopics: ['lazer', 'seguranca'],
      questionText: 'Quer que eu te fale tambem sobre lazer ou seguranca?',
      askedVisitOffer: false,
      askedBrokerHandoff: false,
      askedFollowupTopics: true,
    },
  });

  assert.equal(action.type, 'ambiguous_followup');
  assert.equal(action.topic, null);
});

test('pedido direto "e a seguranca?" responde seguranca sem pedir permissao', () => {
  const policy = applyAnaConversationPolicy({
    conversationId: 201,
    userMessage: 'e a seguranca?',
    replyText: 'Quer que eu te explique a seguranca do empreendimento?',
    isFirstAnaReply: false,
    flowState: {},
    recentMessages: [{ role: 'user', content: 'e a seguranca?' }],
    disableFollowupQuestion: true,
  });

  assert.match(policy.text, /portaria 24 horas com controle de acesso/i);
  assert.equal(/quer que eu te explique a seguranca/i.test(policy.text), false);
});

test('pedido direto "seguranca" responde seguranca', () => {
  const policy = applyAnaConversationPolicy({
    conversationId: 202,
    userMessage: 'seguranca',
    replyText: 'Claro. Quer que eu te explique a seguranca do empreendimento?',
    isFirstAnaReply: false,
    flowState: {},
    recentMessages: [{ role: 'user', content: 'seguranca' }],
    disableFollowupQuestion: true,
  });

  assert.match(policy.text, /portaria 24 horas com controle de acesso/i);
  assert.equal(/quer que eu te explique a seguranca/i.test(policy.text), false);
});

test('"sim" apos oferta de seguranca responde seguranca e nao repete pergunta', () => {
  const recentMessages = [
    { role: 'assistant' as const, content: 'Quer que eu te explique a seguranca do empreendimento?' },
    { role: 'user' as const, content: 'sim' },
  ];
  const context = resolveShortConfirmationContext({
    userText: 'sim',
    recentMessages,
    lastAssistantMessage: recentMessages[0].content,
    flowState: {},
  });

  const policy = applyAnaConversationPolicy({
    conversationId: 203,
    userMessage: 'sim',
    replyText: 'Claro. Quer que eu te explique mais sobre seguranca?',
    isFirstAnaReply: false,
    flowState: {},
    recentMessages,
    disableFollowupQuestion: true,
    shortConfirmationContext: {
      kind: context.kind,
      lastAssistantQuestionType: context.lastAssistantQuestionType,
      lastAssistantQuestionText: context.lastAssistantQuestionText,
      lastOfferedTopics: context.lastOfferedTopics,
    },
  });

  assert.match(policy.text, /portaria 24 horas com controle de acesso/i);
  assert.equal(/quer que eu te explique a seguranca/i.test(policy.text), false);
});

test('"sim" apos oferta de lazer responde lazer completo', () => {
  const recentMessages = [
    { role: 'assistant' as const, content: 'Quer que eu te explique as areas de lazer?' },
    { role: 'user' as const, content: 'sim' },
  ];
  const context = resolveShortConfirmationContext({
    userText: 'sim',
    recentMessages,
    lastAssistantMessage: recentMessages[0].content,
    flowState: {},
  });

  const policy = applyAnaConversationPolicy({
    conversationId: 204,
    userMessage: 'sim',
    replyText: 'Claro. Quer que eu te explique mais sobre lazer?',
    isFirstAnaReply: false,
    flowState: {},
    recentMessages,
    disableFollowupQuestion: true,
    shortConfirmationContext: {
      kind: context.kind,
      lastAssistantQuestionType: context.lastAssistantQuestionType,
      lastAssistantQuestionText: context.lastAssistantQuestionText,
      lastOfferedTopics: context.lastOfferedTopics,
    },
  });

  for (const expected of [
    'Piscina adulto',
    'Academia',
    'Salao de festas',
    'Playground',
    'Coworking',
    'Espaco zen',
    'Fireplace',
    'Quadra de beach tennis',
    'Campo society',
  ]) {
    assert.match(policy.text, new RegExp(expected, 'i'));
  }
  assert.equal(/quer que eu te explique as areas de lazer/i.test(policy.text), false);
});

test('pedido direto "lazer" responde lista completa sem pedir permissao', () => {
  const policy = applyAnaConversationPolicy({
    conversationId: 205,
    userMessage: 'lazer',
    replyText: 'Quer que eu te explique as areas de lazer?',
    isFirstAnaReply: false,
    flowState: {},
    recentMessages: [{ role: 'user', content: 'lazer' }],
    disableFollowupQuestion: true,
  });

  assert.match(policy.text, /as areas de lazer do evora incluem/i);
  assert.match(policy.text, /estacao de carregamento para carros eletricos/i);
  assert.equal(/quer que eu te explique as areas de lazer/i.test(policy.text), false);
});

test('"quantos lotes vai ter" aplica info gap canonico e oferta de corretor', () => {
  const policy = applyAnaConversationPolicy({
    conversationId: 206,
    userMessage: 'quantos lotes vai ter?',
    replyText: 'O projeto ainda esta em andamento e nao sabemos.',
    isFirstAnaReply: false,
    flowState: {},
    recentMessages: [{ role: 'user', content: 'quantos lotes vai ter?' }],
    disableFollowupQuestion: true,
  });

  assert.match(policy.text, /ainda nao tenho essa informacao exata liberada por aqui/i);
  assert.match(policy.text, /quer que eu encaminhe para um corretor te passar certinho\?/i);
  assert.equal(/projeto em andamento|ainda nao sabemos/i.test(policy.text), false);
});

test('primeira saudacao suprime CTA de topico antigo no inicio da resposta', () => {
  const policy = applyAnaConversationPolicy({
    conversationId: 207,
    userMessage: 'oi',
    replyText: 'Quer saber tambem sobre localizacao? O Evora e um loteamento fechado em Atibaia.',
    isFirstAnaReply: true,
    flowState: {
      dialoguePolicy: {
        lastAssistantQuestionType: 'followup_topic',
        lastAssistantQuestionText: 'Quer saber tambem sobre localizacao?',
        lastOfferedTopics: ['localizacao'],
        recentlyAskedTopics: ['localizacao'],
      },
    },
    recentMessages: [{ role: 'user', content: 'oi' }],
    disableFollowupQuestion: true,
  });

  assert.equal(/^\s*quer saber tambem sobre/i.test(policy.text), false);
  assert.match(policy.text, /^ol.*,\s*(bom dia|boa tarde|boa noite),\s*tudo bem\?/i);
});

test('primeira saudacao nunca retorna "Quer saber tambem sobre localizacao? Vou responder todas."', () => {
  const policy = applyAnaConversationPolicy({
    conversationId: 2071,
    userMessage: 'oi',
    replyText: 'Quer saber tambem sobre localizacao? Vou responder todas.',
    isFirstAnaReply: true,
    flowState: {
      dialoguePolicy: {
        lastAssistantQuestionType: 'followup_topic',
        lastAssistantQuestionText: 'Quer saber tambem sobre localizacao?',
        lastOfferedTopics: ['localizacao'],
      },
    },
    recentMessages: [{ role: 'user', content: 'oi' }],
    disableFollowupQuestion: true,
  });

  assert.equal(/quer saber tambem sobre localizacao\?/i.test(policy.text), false);
  assert.equal(/vou responder todas/i.test(policy.text), false);
});

test('frase de fallback ruim nunca fica na resposta final', () => {
  const policy = applyAnaConversationPolicy({
    conversationId: 208,
    userMessage: 'e a seguranca?',
    replyText: 'Posso te responder de forma mais objetiva nesse ponto.',
    isFirstAnaReply: false,
    flowState: {},
    recentMessages: [{ role: 'user', content: 'e a seguranca?' }],
    disableFollowupQuestion: true,
  });

  assert.equal(/posso te responder de forma mais objetiva nesse ponto/i.test(policy.text), false);
  assert.match(policy.text, /portaria 24 horas com controle de acesso/i);
});

test('conversa aberta "me convence" nao cai em regra deterministica e segue trilha Qwen', () => {
  const rule = resolveAnaCommercialRule({
    enterpriseName: 'Evora',
    userMessage: 'me convence',
    isFirstAnaReply: false,
  });
  assert.equal(rule, null);

  const source = readFileSync(path.resolve(process.cwd(), 'services/conversationEngine.ts'), 'utf8');
  assert.match(source, /\[ANA_LLM_DECISION\]/);
  assert.match(source, /willCallQwen:\s*true/);
  assert.match(source, /\[ANA_QWEN_REQUEST_CONTEXT\]/);
  assert.match(source, /\[ANA_QWEN_RAW_RESPONSE\]/);
});

test('quando Qwen e pulado por deterministica, log inclui eixo correto', () => {
  const rule = resolveAnaCommercialRule({
    enterpriseName: 'Evora',
    userMessage: 'e a seguranca?',
    isFirstAnaReply: false,
  });
  assert.equal(rule?.commercialAxis, 'security');

  const source = readFileSync(path.resolve(process.cwd(), 'services/conversationEngine.ts'), 'utf8');
  assert.match(source, /\[ANA_QWEN_SKIPPED_BY_DETERMINISTIC\]/);
  assert.match(source, /axis:\s*effectiveCommercialRule\.commercialAxis/);
});

test('observabilidade de topicos criticos registra logs novos', () => {
  const policySource = readFileSync(path.resolve(process.cwd(), 'utils/anaConversationPolicy.ts'), 'utf8');
  assert.match(policySource, /\[ANA_DIRECT_TOPIC_REQUEST_ANSWERED\]/);
  assert.match(policySource, /\[ANA_ACCEPTED_TOPIC_OFFER_ANSWERED\]/);
  assert.match(policySource, /\[ANA_TOPIC_OFFER_LOOP_SUPPRESSED\]/);
  assert.match(policySource, /\[ANA_BAD_GENERIC_FALLBACK_BLOCKED\]/);
  assert.match(policySource, /\[ANA_FIRST_GREETING_STALE_CTA_SUPPRESSED\]/);

  const engineSource = readFileSync(path.resolve(process.cwd(), 'services/conversationEngine.ts'), 'utf8');
  assert.match(engineSource, /\[ANA_LOT_COUNT_INFO_GAP_HANDLED\]/);
});

test('onde fica esse loteamento resolve localizacao e nao preco', () => {
  const rule = resolveAnaCommercialRule({
    enterpriseName: 'Evora',
    userMessage: 'onde fica esse loteamento?',
    isFirstAnaReply: false,
  });
  assert.equal(rule?.ruleId, 'localizacao_endereco');
  assert.equal(rule?.commercialAxis, 'location');
  assert.equal(/valor inicial|parcela|simulacao/i.test((rule?.messages ?? []).join(' ')), false);
});

test('pedido direto "localizacao" responde localizacao normal e nao fluxo de link', () => {
  const policy = applyAnaConversationPolicy({
    conversationId: 910,
    userMessage: 'localizacao',
    replyText: 'Nao tenho um link de localizacao liberado para envio por aqui.',
    isFirstAnaReply: false,
    flowState: {},
    recentMessages: [{ role: 'user', content: 'localizacao' }],
    disableFollowupQuestion: true,
  });

  assert.match(policy.text, /atibaia|pedreira|rodovia dom pedro i/i);
  assert.equal(/nao tenho um link de localizacao liberado/i.test(policy.text), false);
});

test('pedido direto "onde fica?" responde localizacao normal e nao fluxo de link', () => {
  const policy = applyAnaConversationPolicy({
    conversationId: 9101,
    userMessage: 'onde fica?',
    replyText: 'Nao tenho um link de localizacao liberado para envio por aqui.',
    isFirstAnaReply: false,
    flowState: {},
    recentMessages: [{ role: 'user', content: 'onde fica?' }],
    disableFollowupQuestion: true,
  });

  assert.match(policy.text, /atibaia|pedreira|rodovia dom pedro i/i);
  assert.equal(/nao tenho um link de localizacao liberado/i.test(policy.text), false);
});

test('pedido direto "endereco" responde localizacao normal e nao fluxo de link', () => {
  const policy = applyAnaConversationPolicy({
    conversationId: 9102,
    userMessage: 'endereco',
    replyText: 'Nao tenho um link de localizacao liberado para envio por aqui.',
    isFirstAnaReply: false,
    flowState: {},
    recentMessages: [{ role: 'user', content: 'endereco' }],
    disableFollowupQuestion: true,
  });

  assert.match(policy.text, /atibaia|pedreira|rodovia dom pedro i/i);
  assert.equal(/nao tenho um link de localizacao liberado/i.test(policy.text), false);
});

test('onde fica esse loteamento responde localizacao normal, nao preco e nao link', () => {
  const policy = applyAnaConversationPolicy({
    conversationId: 911,
    userMessage: 'onde fica esse loteamento?',
    replyText: 'O valor inicial e esse.',
    isFirstAnaReply: false,
    flowState: {},
    recentMessages: [{ role: 'user', content: 'onde fica esse loteamento?' }],
    disableFollowupQuestion: true,
  });

  assert.match(policy.text, /atibaia|pedreira|rodovia dom pedro i/i);
  assert.equal(/valor inicial|parcela|simulacao/i.test(policy.text), false);
  assert.equal(/link de localizacao|google maps|rota/i.test(policy.text), false);
});

test('pedido explicito de link de localizacao permanece no fluxo de link/rota', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'services/conversationEngine.ts'), 'utf8');
  assert.match(source, /tem link da localizacao/);
  assert.match(source, /google maps/);
  assert.match(source, /me envia a localizacao/);
  assert.match(source, /manda a localizacao pfv/);
  assert.match(source, /nao entendi onde fica/);
  assert.match(source, /if \(isLocationLinkRequest\(trimmed\) && isEvoraEnterpriseName/);
});

test('engine prioriza aliases de link de localizacao em variablesMap', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'services/conversationEngine.ts'), 'utf8');
  assert.match(source, /google_maps_url/);
  assert.match(source, /maps_url/);
  assert.match(source, /location_url/);
  assert.match(source, /localizacao_url/);
  assert.match(source, /link_localizacao/);
  assert.match(source, /link_google_maps/);
  assert.match(source, /endereco_google_maps/);
  assert.match(source, /exact_location_url/);
  assert.match(source, /exactlocation/);
  assert.match(source, /localizacao_exata/);
});

test('depois de pergunta de valor, onde fica continua localizacao', () => {
  const first = resolveAnaCommercialRule({
    enterpriseName: 'Evora',
    userMessage: 'qual o valor?',
    isFirstAnaReply: false,
  });
  const second = resolveAnaCommercialRule({
    enterpriseName: 'Evora',
    userMessage: 'onde fica?',
    isFirstAnaReply: false,
  });
  assert.equal(first?.ruleId, 'preco_valor_lote');
  assert.equal(second?.ruleId, 'localizacao_endereco');
});

test('oferta antiga de lazer e ignorada quando cliente pede localizacao', () => {
  const policy = applyAnaConversationPolicy({
    conversationId: 901,
    userMessage: 'onde fica?',
    replyText: 'Quer que eu te explique as areas de lazer?',
    isFirstAnaReply: false,
    flowState: {
      dialoguePolicy: {
        lastAssistantQuestionType: 'followup_topic',
        lastAssistantQuestionText: 'Quer que eu te explique as areas de lazer?',
        lastOfferedTopics: ['lazer'],
      },
    },
    recentMessages: [
      { role: 'assistant', content: 'Quer que eu te explique as areas de lazer?' },
      { role: 'user', content: 'onde fica?' },
    ],
    disableFollowupQuestion: true,
    shortConfirmationContext: {
      kind: 'followup_topic_confirmation',
      lastAssistantQuestionType: 'followup_topic',
      lastAssistantQuestionText: 'Quer que eu te explique as areas de lazer?',
      lastOfferedTopics: ['lazer'],
    },
  });
  assert.match(policy.text, /atibaia|pedreira|rodovia dom pedro i/i);
  assert.equal(/quer que eu te explique as areas de lazer/i.test(policy.text), false);
});

test('"sim" usa estado commitado de oferta unica (qwen/policy) e responde lazer', () => {
  const context = resolveShortConfirmationContext({
    userText: 'sim',
    recentMessages: [{ role: 'user', content: 'sim' }],
    flowState: {
      dialoguePolicy: {
        lastAssistantQuestionType: 'single_topic_offer',
        lastAssistantQuestionText: 'Quer que eu te explique as areas de lazer?',
        lastOfferedTopics: ['lazer'],
      },
    },
  });
  assert.equal(context.kind, 'followup_topic_confirmation');
  assert.equal(context.source, 'state');
  assert.deepEqual(context.lastOfferedTopics, ['lazer']);

  const policy = applyAnaConversationPolicy({
    conversationId: 2041,
    userMessage: 'sim',
    replyText: 'Me confirma so qual ponto voce quer que eu detalhe: lazer, seguranca, localizacao ou formas de pagamento?',
    isFirstAnaReply: false,
    flowState: {
      dialoguePolicy: {
        lastAssistantQuestionType: 'single_topic_offer',
        lastAssistantQuestionText: 'Quer que eu te explique as areas de lazer?',
        lastOfferedTopics: ['lazer'],
      },
    },
    recentMessages: [{ role: 'user', content: 'sim' }],
    disableFollowupQuestion: true,
    shortConfirmationContext: {
      kind: context.kind,
      lastAssistantQuestionType: context.lastAssistantQuestionType,
      lastAssistantQuestionText: context.lastAssistantQuestionText,
      lastOfferedTopics: context.lastOfferedTopics,
    },
  });

  assert.match(policy.text, /piscina adulto/i);
  assert.equal(/me confirma so qual ponto/i.test(policy.text), false);
});

test('"sim" usa estado commitado de oferta unica de seguranca e responde seguranca', () => {
  const context = resolveShortConfirmationContext({
    userText: 'sim',
    recentMessages: [{ role: 'user', content: 'sim' }],
    flowState: {
      dialoguePolicy: {
        lastAssistantQuestionType: 'single_topic_offer',
        lastAssistantQuestionText: 'Quer que eu te explique a seguranca do empreendimento?',
        lastOfferedTopics: ['seguranca'],
      },
    },
  });
  assert.equal(context.kind, 'followup_topic_confirmation');
  assert.equal(context.source, 'state');

  const policy = applyAnaConversationPolicy({
    conversationId: 2042,
    userMessage: 'sim',
    replyText: 'Me confirma so qual ponto voce quer que eu detalhe: lazer, seguranca, localizacao ou formas de pagamento?',
    isFirstAnaReply: false,
    flowState: {
      dialoguePolicy: {
        lastAssistantQuestionType: 'single_topic_offer',
        lastAssistantQuestionText: 'Quer que eu te explique a seguranca do empreendimento?',
        lastOfferedTopics: ['seguranca'],
      },
    },
    recentMessages: [{ role: 'user', content: 'sim' }],
    disableFollowupQuestion: true,
    shortConfirmationContext: {
      kind: context.kind,
      lastAssistantQuestionType: context.lastAssistantQuestionType,
      lastAssistantQuestionText: context.lastAssistantQuestionText,
      lastOfferedTopics: context.lastOfferedTopics,
    },
  });

  assert.match(policy.text, /portaria 24 horas com controle de acesso/i);
  assert.equal(/me confirma so qual ponto/i.test(policy.text), false);
});

test('"sim" com estado commitado de oferta multi-topico pede escolha', () => {
  const context = resolveShortConfirmationContext({
    userText: 'sim',
    recentMessages: [{ role: 'user', content: 'sim' }],
    flowState: {
      dialoguePolicy: {
        lastAssistantQuestionType: 'multi_topic_offer',
        lastAssistantQuestionText: 'Quer que eu te fale sobre lazer ou localizacao?',
        lastOfferedTopics: ['lazer', 'localizacao'],
      },
    },
  });
  assert.equal(context.kind, 'followup_topic_confirmation');
  assert.equal(context.source, 'state');
  assert.equal(context.lastOfferedTopics.length >= 2, true);

  const policy = applyAnaConversationPolicy({
    conversationId: 2043,
    userMessage: 'sim',
    replyText: 'Perfeito. Para qual dia voce prefere agendar a visita?',
    isFirstAnaReply: false,
    flowState: {
      dialoguePolicy: {
        lastAssistantQuestionType: 'multi_topic_offer',
        lastAssistantQuestionText: 'Quer que eu te fale sobre lazer ou localizacao?',
        lastOfferedTopics: ['lazer', 'localizacao'],
      },
    },
    recentMessages: [{ role: 'user', content: 'sim' }],
    disableFollowupQuestion: true,
    shortConfirmationContext: {
      kind: context.kind,
      lastAssistantQuestionType: context.lastAssistantQuestionType,
      lastAssistantQuestionText: context.lastAssistantQuestionText,
      lastOfferedTopics: context.lastOfferedTopics,
    },
  });

  assert.equal(/agendar|visita/i.test(policy.text), false);
  assert.match(policy.text, /lazer|localiza|qual dos dois/i);
});

test('pedido de rota sem link autorizado nao repete promessa de referencia', () => {
  const guarded = applyAnaNoRepeatMessageGuard({
    conversationId: 902,
    enterpriseId: 10,
    enterpriseName: 'Evora',
    userMessage: 'me manda a localizacao para rota',
    answer: 'O Evora fica em Atibaia, na regiao da Pedreira, com acesso pela Rodovia Dom Pedro I.',
    recentAssistantReplies: ['O Evora fica em Atibaia, na regiao da Pedreira, com acesso pela Rodovia Dom Pedro I.'],
    semanticallySimilar: (a, b) => a.toLowerCase() === b.toLowerCase(),
  });
  assert.equal(guarded.changed, false);
  assert.match(guarded.text, /atibaia|pedreira|rodovia dom pedro i/i);
  assert.equal(/referencia de acesso/i.test(guarded.text), false);
});

test('no-repeat guard nao troca resposta correta por fallback deterministico', () => {
  const guarded = applyAnaNoRepeatMessageGuard({
    conversationId: 903,
    enterpriseId: 10,
    enterpriseName: 'Evora',
    userMessage: 'onde fica?',
    answer: 'O Evora fica em Atibaia, na regiao da Pedreira, com acesso pela Rodovia Dom Pedro I.',
    recentAssistantReplies: ['O Evora fica em Atibaia, na regiao da Pedreira, com acesso pela Rodovia Dom Pedro I.'],
    semanticallySimilar: (a, b) => a.toLowerCase() === b.toLowerCase(),
  });
  assert.equal(guarded.changed, false);
  assert.match(guarded.text, /atibaia|pedreira|rodovia dom pedro i/i);
  assert.equal(/nao tenho um link de localizacao liberado/i.test(guarded.text), false);
});

test('logs de orquestracao de turno estao presentes', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'services/conversationEngine.ts'), 'utf8');
  assert.match(source, /\[ANA_TURN_CONTEXT_RESOLVED\]/);
  assert.match(source, /\[ANA_TURN_DECISION_SELECTED\]/);
  assert.match(source, /\[ANA_TURN_RESPONSE_COMMITTED\]/);
  assert.match(source, /\[ANA_TURN_EXTRA_HANDLER_SUPPRESSED\]/);
  assert.match(source, /\[ANA_DUPLICATE_RESPONSE_PART_SUPPRESSED\]/);
  assert.match(source, /\[ANA_CONTEXT_STALE_TOPIC_IGNORED\]/);
  assert.match(source, /\[ANA_COMMITTED_REPLY_STATE_EXTRACTED\]/);
  assert.match(source, /\[ANA_COMMITTED_REPLY_STATE_SAVED\]/);
  assert.match(source, /\[ANA_ACCEPTED_COMMITTED_TOPIC_OFFER\]/);
  assert.match(source, /\[ANA_LOCATION_LINK_INTENT_REJECTED_DIRECT_LOCATION\]/);
  assert.match(source, /\[ANA_FIRST_GREETING_FINAL_NORMALIZED\]/);
  assert.match(source, /\[ANA_FIRST_GREETING_FORBIDDEN_PHRASE_REMOVED\]/);
  assert.match(source, /\[ANA_COMMERCIAL_RULES_BYPASSED_CANONICAL_BASE\]/);
  assert.match(source, /\[ANA_VISIT_SCHEDULING_BYPASSED_COMMERCIAL_QUESTION\]/);
  assert.match(source, /\[ANA_VISIT_SCHEDULING_BYPASS_EVALUATED\]/);
  assert.match(source, /\[ANA_VISIT_STATE_CLEARED_AFTER_FALSE_POSITIVE\]/);

  const guardsSource = readFileSync(path.resolve(process.cwd(), 'utils/anaEvoraCommercialGuards.ts'), 'utf8');
  assert.match(guardsSource, /\[ANA_NO_REPEAT_MESSAGE_GUARD\]/);
});

test('qwen e deterministico passam pelo mesmo commit final sem envio extra', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'services/conversationEngine.ts'), 'utf8');
  assert.match(source, /commitTurnResponse\(/);
  assert.match(source, /evoraKnowledgeDrivenMode/);
  assert.equal(source.includes('ana_main_reply_visit_offer'), false);
});

test('engine preserva scheduled apos commit e reaproveita nome coletado no fluxo de visita', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'services/conversationEngine.ts'), 'utf8');
  assert.match(source, /visitCustomerNameBeforeDecision/);
  assert.match(source, /effectiveConv\.customer_name \|\|\s*visitCustomerNameBeforeDecision/);
  assert.match(source, /appointmentConfirmed && scheduledVisitStateSnapshot\?\.visitScheduling\?\.status === 'scheduled'/);
  assert.match(source, /pendingVisitScheduling: false/);
  assert.match(source, /status: 'scheduled' as const/);
});

test('split de outbound da Ana envia cada linha como mensagem separada', () => {
  const parts = __testOnlySplitAnaOutboundMessages('linha 1\n\nlinha 2\nlinha 3\n');
  assert.deepEqual(parts, ['linha 1', 'linha 2', 'linha 3']);
});

test('policy em modo knowledge-driven nao injeta pergunta artificial de topico', () => {
  const policy = applyAnaConversationPolicy({
    conversationId: 4100,
    userMessage: 'endereco',
    replyText: 'Fica na Estrada dos Pires, s/n, na regiao da Pedreira, bairro Rio Abaixo, em Atibaia.',
    isFirstAnaReply: false,
    flowState: {},
    recentMessages: [{ role: 'user', content: 'endereco' }],
    disableFollowupQuestion: false,
    knowledgeDrivenMode: true,
  });
  assert.equal(/quer que eu te explique|quer saber tambem sobre|qual ponto voce quer/i.test(policy.text), false);
  assert.match(policy.text, /estrada dos pires|atibaia|rio abaixo/i);
});

test('engine do evora nao força resposta deterministica de localizacao nem triplet fixo', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'services/conversationEngine.ts'), 'utf8');
  assert.equal(source.includes('ANA_EVORA_LOCATION_TRIPLET_SELECTED'), false);
  assert.equal(source.includes('EVORA_LOCATION_REPLY_CHUNKS'), false);
  assert.match(source, /evoraKnowledgeDrivenMode/);
  assert.match(source, /ANA_COMMERCIAL_RULES_BYPASSED_CANONICAL_BASE/);
});



