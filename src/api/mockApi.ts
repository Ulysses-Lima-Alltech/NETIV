import type { Conversation, Message } from '../types';

const MOCK_DELAY_MS = 400;

const mockConversations: Conversation[] = [
  {
    id: '1',
    leadName: 'Maria Silva',
    leadPhone: '+55 11 98765-4321',
    lastMessage: 'Obrigado! Quando posso receber a proposta?',
    updatedAt: new Date().toISOString(),
    unreadCount: 2,
    status: 'EM_ANDAMENTO',
    empreendimento: 'Evora',
    temperatura: 'quente',
  },
  {
    id: '2',
    leadName: 'João Santos',
    leadPhone: '+55 21 99876-5432',
    lastMessage: 'Tenho interesse no plano empresarial.',
    updatedAt: new Date(Date.now() - 3600000).toISOString(),
    unreadCount: 0,
    status: 'QUALIFICADO',
    empreendimento: 'Montaresa',
    temperatura: 'morno',
  },
  {
    id: '3',
    leadName: 'Lead sem nome',
    leadPhone: '+55 31 91234-5678',
    lastMessage: 'Oi, boa tarde!',
    updatedAt: new Date(Date.now() - 86400000).toISOString(),
    unreadCount: 1,
    status: 'NOVO',
    empreendimento: 'Montaresa',
    temperatura: 'frio',
  },
  {
    id: '4',
    leadName: 'Ana Costa',
    leadPhone: '+55 41 97654-3210',
    lastMessage: 'Perfeito, vou analisar e retorno.',
    updatedAt: new Date(Date.now() - 172800000).toISOString(),
    unreadCount: 0,
    status: 'HANDOFF',
    empreendimento: 'Evora',
    temperatura: 'quente',
  },
];

const mockMessagesByConversation: Record<string, Message[]> = {
  '1': [
    { id: 'm1', conversationId: '1', sender: 'LEAD', text: 'Olá, gostaria de saber mais sobre os planos.', createdAt: new Date(Date.now() - 86400000 * 2).toISOString() },
    { id: 'm2', conversationId: '1', sender: 'AGENT', text: 'Olá Maria! Claro, temos planos básico, profissional e empresarial. Qual perfil se encaixa melhor?', createdAt: new Date(Date.now() - 86400000 * 2 + 60000).toISOString() },
    { id: 'm3', conversationId: '1', sender: 'LEAD', text: 'Sou MEI, então o básico ou profissional.', createdAt: new Date(Date.now() - 86400000).toISOString() },
    { id: 'm4', conversationId: '1', sender: 'AGENT', text: 'Para MEI o profissional é o mais indicado. Posso enviar a proposta em PDF?', createdAt: new Date(Date.now() - 86400000 + 120000).toISOString() },
    { id: 'm5', conversationId: '1', sender: 'LEAD', text: 'Obrigado! Quando posso receber a proposta?', createdAt: new Date().toISOString() },
  ],
  '2': [
    { id: 'm6', conversationId: '2', sender: 'LEAD', text: 'Bom dia, quero informações sobre o plano empresarial.', createdAt: new Date(Date.now() - 86400000).toISOString() },
    { id: 'm7', conversationId: '2', sender: 'AGENT', text: 'Bom dia João! O plano empresarial inclui até 10 usuários e suporte prioritário. Deseja agendar uma demonstração?', createdAt: new Date(Date.now() - 86400000 + 30000).toISOString() },
    { id: 'm8', conversationId: '2', sender: 'LEAD', text: 'Tenho interesse no plano empresarial.', createdAt: new Date(Date.now() - 3600000).toISOString() },
  ],
  '3': [
    { id: 'm9', conversationId: '3', sender: 'LEAD', text: 'Oi, boa tarde!', createdAt: new Date(Date.now() - 86400000).toISOString() },
  ],
  '4': [
    { id: 'm10', conversationId: '4', sender: 'LEAD', text: 'Preciso falar com um consultor para fechar o contrato.', createdAt: new Date(Date.now() - 172800000).toISOString() },
    { id: 'm11', conversationId: '4', sender: 'AGENT', text: 'Perfeito, vou transferir para nossa equipe comercial. Você receberá um retorno em até 24h.', createdAt: new Date(Date.now() - 172800000 + 60000).toISOString() },
    { id: 'm12', conversationId: '4', sender: 'LEAD', text: 'Perfeito, vou analisar e retorno.', createdAt: new Date(Date.now() - 172800000 + 120000).toISOString() },
  ],
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function listConversations(): Promise<Conversation[]> {
  await delay(MOCK_DELAY_MS);
  return [...mockConversations].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

export async function getMessages(conversationId: string): Promise<Message[]> {
  await delay(MOCK_DELAY_MS);
  const messages = mockMessagesByConversation[conversationId] ?? [];
  return [...messages].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
}

export async function sendMessage(conversationId: string, text: string): Promise<Message> {
  await delay(200);
  const newMessage: Message = {
    id: `m${Date.now()}`,
    conversationId,
    sender: 'AGENT',
    text,
    createdAt: new Date().toISOString(),
  };
  const list = mockMessagesByConversation[conversationId] ?? [];
  list.push(newMessage);
  mockMessagesByConversation[conversationId] = list;
  const conv = mockConversations.find((c) => c.id === conversationId);
  if (conv) {
    conv.lastMessage = text;
    conv.updatedAt = newMessage.createdAt;
  }
  return newMessage;
}
