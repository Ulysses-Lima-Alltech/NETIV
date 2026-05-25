import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
  sanitizeTooManyQuestionsReply,
} from '../utils/anaReplyFinalize.js';
import { resolveAnaOpenAIModel } from '../utils/resolveAnaOpenAIModel.js';
import {
  applyAnaConversationPolicy,
  evaluateAnaReengagementPolicy,
} from '../utils/anaConversationPolicy.js';
import { handleVisitSchedulingDeterministically } from '../utils/anaDirectVisitScheduling.js';
import {
  extractCustomerNameFromUserUtterance,
  isUncertainCustomerNameCue,
} from '../utils/extractCustomerNameFromMessage.js';
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
  assert.match(decision.reply ?? '', /qual horário fica melhor para você/i);
});

test('apelido nao vira nome automaticamente', () => {
  const extracted = extractCustomerNameFromUserUtterance('Pode me chamar de Mestre');
  const uncertain = isUncertainCustomerNameCue('Mestre kkk');

  assert.equal(extracted, null);
  assert.equal(uncertain, true);
});

test('apos responder lazer, follow-up evita visita e corretor por padrao', () => {
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

  assert.match(policy.text, /\?/);
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
  assert.match(policy.text, /qual horário fica melhor para você/i);
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


