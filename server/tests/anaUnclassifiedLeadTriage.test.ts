import assert from 'node:assert/strict';
import test from 'node:test';
import { ANA_EMERGENCY_HANDOFF_MESSAGE } from '../constants/anaMessages.js';
import type { ConversationRow } from '../repositories/conversationRepository.js';
import type { EnterpriseRow } from '../repositories/enterpriseRepository.js';
import { runUnclassifiedLeadTriage } from '../services/anaUnclassifiedLeadTriageService.js';
import type { UnclassifiedLeadTriageState } from '../utils/commercialFlowState.js';
import {
  decideUnclassifiedLeadTriage,
  getTriageCities,
  isTriageCityAnswer,
  parseUnclassifiedLeadTriageState,
  renderInitialTriageMessage,
} from '../utils/anaUnclassifiedLeadTriage.js';

const enterprises = [
  { id: 1, name: 'Projeto A', city: 'Atibaia' },
  { id: 2, name: 'Projeto B', city: 'São Paulo' },
];

test('campo vazio mantém exatamente o texto antigo', () => {
  assert.equal(renderInitialTriageMessage('   ', ['Atibaia']), ANA_EMERGENCY_HANDOFF_MESSAGE);
});

test('substitui cidades cadastradas sem lista hardcoded', () => {
  assert.equal(
    renderInitialTriageMessage('Temos opções em {cidades}.', ['Atibaia', 'São Paulo']),
    'Temos opções em Atibaia e São Paulo.'
  );
});

test('resposta inicial configurada recebe a lista dinâmica de cidades', () => {
  const result = decideUnclassifiedLeadTriage({
    text: 'Olá',
    enterprises,
    previousState: null,
    initialMessage: 'Temos opções em {cidades}.',
    explicitEnterpriseId: null,
  });
  assert.equal(result.kind, 'reply');
  if (result.kind !== 'reply') return;
  assert.equal(result.text, 'Temos opções em Atibaia e São Paulo.');
});

test('normaliza acentos e lista apenas empreendimentos da cidade escolhida', () => {
  const result = decideUnclassifiedLeadTriage({
    text: 'sao paulo',
    enterprises,
    previousState: null,
    initialMessage: null,
    explicitEnterpriseId: null,
  });
  assert.equal(result.kind, 'reply');
  if (result.kind !== 'reply') return;
  assert.deepEqual(result.nextState.offeredEnterpriseIds, [2]);
  assert.ok(result.text.includes('Projeto B'));
  assert.ok(!result.text.includes('Projeto A'));
});

test('resposta que contém apenas uma cidade é reconhecida como cidade, não como escolha', () => {
  assert.equal(isTriageCityAnswer('São Paulo', enterprises), true);
  assert.equal(isTriageCityAnswer('Quero o Projeto B em São Paulo', enterprises), false);
});

test('cidade desconhecida não classifica e mantém o fallback padrão', () => {
  const result = decideUnclassifiedLeadTriage({
    text: 'Campinas',
    enterprises,
    previousState: null,
    initialMessage: null,
    explicitEnterpriseId: null,
  });
  assert.equal(result.kind, 'reply');
  if (result.kind !== 'reply') return;
  assert.equal(result.text, ANA_EMERGENCY_HANDOFF_MESSAGE);
  assert.equal(result.nextState.stage, 'awaiting_city');
});

test('cidade nunca classifica automaticamente, mesmo com uma opção', () => {
  const result = decideUnclassifiedLeadTriage({
    text: 'Atibaia',
    enterprises: [enterprises[0]!],
    previousState: null,
    initialMessage: null,
    explicitEnterpriseId: null,
  });
  assert.equal(result.kind, 'reply');
  if (result.kind !== 'reply') return;
  assert.deepEqual(result.nextState.offeredEnterpriseIds, [1]);
});

test('número seleciona somente empreendimento oferecido na etapa anterior', () => {
  const result = decideUnclassifiedLeadTriage({
    text: '1',
    enterprises,
    previousState: {
      stage: 'awaiting_enterprise',
      cityKey: 'sao paulo',
      offeredEnterpriseIds: [2],
    },
    initialMessage: null,
    explicitEnterpriseId: null,
  });
  assert.deepEqual(result, { kind: 'resolved', enterpriseId: 2 });
});

test('número sem lista anterior não classifica empreendimento', () => {
  const result = decideUnclassifiedLeadTriage({
    text: '1',
    enterprises,
    previousState: null,
    initialMessage: null,
    explicitEnterpriseId: null,
  });
  assert.notEqual(result.kind, 'resolved');
});

test('opção removida do catálogo não é classificada', () => {
  const result = decideUnclassifiedLeadTriage({
    text: '1',
    enterprises: enterprises.filter((item) => item.id !== 2),
    previousState: {
      stage: 'awaiting_enterprise',
      cityKey: 'sao paulo',
      offeredEnterpriseIds: [2],
    },
    initialMessage: null,
    explicitEnterpriseId: null,
  });
  assert.equal(result.kind, 'reply');
});

test('alias explícito ambíguo oferece somente os candidatos encontrados', () => {
  const result = decideUnclassifiedLeadTriage({
    text: 'Projeto',
    enterprises,
    previousState: null,
    initialMessage: null,
    explicitEnterpriseId: null,
    ambiguousEnterpriseOptions: [
      { id: 1, name: 'Projeto A' },
      { id: 2, name: 'Projeto B' },
    ],
  });
  assert.equal(result.kind, 'reply');
  if (result.kind !== 'reply') return;
  assert.deepEqual(result.nextState.offeredEnterpriseIds, [1, 2]);
  assert.match(result.text, /mais de um empreendimento/);

  const clarification = decideUnclassifiedLeadTriage({
    text: 'Não sei',
    enterprises,
    previousState: result.nextState,
    initialMessage: null,
    explicitEnterpriseId: null,
  });
  assert.equal(clarification.kind, 'reply');
  if (clarification.kind !== 'reply') return;
  assert.deepEqual(clarification.nextState.offeredEnterpriseIds, [1, 2]);
});

test('catálogo longo usa páginas e preserva o número da opção visível', () => {
  const largeCatalog = Array.from({ length: 12 }, (_, index) => ({
    id: index + 1,
    name: `Projeto ${index + 1}`,
    city: 'Atibaia',
  }));
  const firstPage = decideUnclassifiedLeadTriage({
    text: 'Atibaia',
    enterprises: largeCatalog,
    previousState: null,
    initialMessage: null,
    explicitEnterpriseId: null,
  });
  assert.equal(firstPage.kind, 'reply');
  if (firstPage.kind !== 'reply') return;
  assert.equal(firstPage.nextState.offeredEnterpriseIds.length, 10);
  assert.match(firstPage.text, /mais opções/);

  const secondPage = decideUnclassifiedLeadTriage({
    text: 'mais opções',
    enterprises: largeCatalog,
    previousState: firstPage.nextState,
    initialMessage: null,
    explicitEnterpriseId: null,
  });
  assert.equal(secondPage.kind, 'reply');
  if (secondPage.kind !== 'reply') return;
  assert.equal(secondPage.nextState.offeredEnterpriseIds.length, 2);
  const secondVisibleEnterpriseId = secondPage.nextState.offeredEnterpriseIds[1];

  const selected = decideUnclassifiedLeadTriage({
    text: '2',
    enterprises: largeCatalog,
    previousState: secondPage.nextState,
    initialMessage: null,
    explicitEnterpriseId: null,
  });
  assert.deepEqual(selected, { kind: 'resolved', enterpriseId: secondVisibleEnterpriseId });
});

test('deduplica cidades ignorando caixa e acentos', () => {
  assert.deepEqual(
    getTriageCities([
      { id: 1, name: 'Projeto A', city: 'São Paulo' },
      { id: 2, name: 'Projeto B', city: 'Sao Paulo' },
    ]),
    ['São Paulo']
  );
});

test('cidades homônimas exigem UF e não misturam empreendimentos', () => {
  const sameNameCities = [
    { id: 1, name: 'Projeto SP', city: 'Atibaia', state_uf: 'SP' },
    { id: 2, name: 'Projeto RJ', city: 'Atibaia', state_uf: 'RJ' },
  ];
  assert.deepEqual(getTriageCities(sameNameCities), ['Atibaia/RJ', 'Atibaia/SP']);
  assert.equal(isTriageCityAnswer('Atibaia', sameNameCities), false);
  assert.equal(isTriageCityAnswer('Atibaia/SP', sameNameCities), true);

  const result = decideUnclassifiedLeadTriage({
    text: 'Atibaia/SP',
    enterprises: sameNameCities,
    previousState: null,
    initialMessage: null,
    explicitEnterpriseId: null,
  });
  assert.equal(result.kind, 'reply');
  if (result.kind !== 'reply') return;
  assert.deepEqual(result.nextState.offeredEnterpriseIds, [1]);
  assert.match(result.text, /Projeto SP/);
  assert.doesNotMatch(result.text, /Projeto RJ/);
});

test('descarta estado de triagem malformado e limita IDs armazenados', () => {
  assert.equal(parseUnclassifiedLeadTriageState({ stage: 'bad', offeredEnterpriseIds: [] }), null);
  const state = parseUnclassifiedLeadTriageState({
    stage: 'awaiting_enterprise',
    cityKey: 'atibaia',
    offeredEnterpriseIds: Array.from({ length: 60 }, (_, index) => index + 1),
  });
  assert.equal(state?.offeredEnterpriseIds.length, 50);
});

test('serviço percorre cidade, opções e escolha sem criar handoff', async () => {
  let conversation: ConversationRow = {
    id: 10,
    channel: 'whatsapp',
    external_contact_id: '5511999999999',
    contact_phone: '5511999999999',
    customer_name: null,
    enterprise_id: null,
    classification: 'Novo',
    lead_temperature: null,
    handoff: false,
    meta_phone_number_id: null,
    last_message_at: null,
    created_at: new Date(),
    updated_at: new Date(),
    manual_closed_at: null,
    conversation_type: 'CLIENT',
    contact_id: null,
    commercial_flow_state: {},
  } as ConversationRow;
  const storedTriageState: { current: ReturnType<typeof parseUnclassifiedLeadTriageState> } = { current: null };
  const sent: string[] = [];
  let assignedEnterpriseId: number | null = null;
  const deps = {
    source: 'ana_inbound_engine' as const,
    loadConversation: async () => conversation,
    loadEnterprises: async () => enterprises as unknown as EnterpriseRow[],
    resolveEnterprise: async ({ userMessage }: { userMessage: string }) => {
      assert.notEqual(userMessage, 'sao paulo');
      return {
        source: 'unresolved' as const,
        enterpriseId: null,
        enterpriseName: null,
        candidates: [],
        reasonWhenNoEnterprise: 'message_without_enterprise_alias',
      };
    },
    loadSettings: async () => ({
      initialMessage: 'Atendemos {cidades}. Qual cidade procura?',
      followUpMessage: null,
      defaultMessage: ANA_EMERGENCY_HANDOFF_MESSAGE,
    }),
    assignEnterprise: async (current: ConversationRow, enterpriseId: number) => {
      assignedEnterpriseId = enterpriseId;
      conversation = { ...current, enterprise_id: enterpriseId };
      return conversation;
    },
    persistState: async (_conversationId: number, nextState: UnclassifiedLeadTriageState | null) => {
      storedTriageState.current = nextState;
      return true;
    },
    sendReply: async (_current: ConversationRow, text: string) => {
      sent.push(text);
      return true;
    },
  };

  const initial = await runUnclassifiedLeadTriage({
    conversationId: conversation.id,
    userMessage: 'Olá',
    deps,
  });
  assert.equal(initial.kind, 'replied');
  assert.equal(sent[0], 'Atendemos Atibaia e São Paulo. Qual cidade procura?');
  assert.equal(storedTriageState.current?.stage, 'awaiting_city');
  assert.equal(assignedEnterpriseId, null);

  conversation = {
    ...conversation,
    commercial_flow_state: { unclassifiedLeadTriage: storedTriageState.current },
  };
  const city = await runUnclassifiedLeadTriage({
    conversationId: conversation.id,
    userMessage: 'São Paulo',
    deps,
  });
  assert.equal(city.kind, 'replied');
  assert.match(sent[1] ?? '', /Projeto B/);
  assert.doesNotMatch(sent[1] ?? '', /Projeto A/);
  assert.deepEqual(storedTriageState.current?.offeredEnterpriseIds, [2]);

  conversation = {
    ...conversation,
    commercial_flow_state: { unclassifiedLeadTriage: storedTriageState.current },
  };
  const selected = await runUnclassifiedLeadTriage({
    conversationId: conversation.id,
    userMessage: '1',
    deps,
  });
  assert.equal(selected.kind, 'resolved');
  assert.equal(assignedEnterpriseId, 2);
  assert.equal(storedTriageState.current, null);
  assert.equal(conversation.handoff, false);
});
