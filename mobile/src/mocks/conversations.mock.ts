import { Conversation, ConversationMessage } from "../types/conversation.types";

export type ConversationCommercialMock = {
  leadTemperature: string;
  visitInfo: string;
};

export const CONVERSATIONS_MOCK: Conversation[] = [
  {
    id: "1",
    clientName: "Carlos Silva",
    enterpriseName: "Evora",
    lastMessage: "Quero entender as condicoes de entrada para fechar ainda hoje.",
    status: "ANA",
    needsHuman: false,
    unread: true,
    assignedBrokerName: "Joao Corretor",
  },
  {
    id: "2",
    clientName: "Mariana Costa",
    enterpriseName: "Evora",
    lastMessage: "Podemos confirmar a visita para amanha no fim da tarde?",
    status: "HUMAN",
    needsHuman: true,
    unread: false,
    assignedBrokerName: "Mariana Corretora",
  },
  {
    id: "3",
    clientName: "Rafael Gomes",
    enterpriseName: "Montaresa",
    lastMessage: "Recebi a proposta e preciso validar a tabela final com minha familia.",
    status: "ANA",
    needsHuman: false,
    unread: false,
    assignedBrokerName: "Lucas Corretor",
  },
  {
    id: "4",
    clientName: "Aline Souza",
    enterpriseName: "Altis",
    lastMessage: "Tenho interesse no financiamento e queria os proximos passos.",
    status: "HUMAN",
    needsHuman: false,
    unread: true,
    assignedBrokerName: "Joao Corretor",
  },
];

export const CONVERSATION_COMMERCIAL_MOCK: Record<string, ConversationCommercialMock> = {
  "1": {
    leadTemperature: "Quente",
    visitInfo: "Hoje, 16:00",
  },
  "2": {
    leadTemperature: "Quente",
    visitInfo: "Amanha, 17:30",
  },
  "3": {
    leadTemperature: "Em negociacao",
    visitInfo: "Sexta, 11:00",
  },
  "4": {
    leadTemperature: "Quente",
    visitInfo: "Sem visita",
  },
};

export const CONVERSATION_MESSAGES_MOCK: Record<string, ConversationMessage[]> = {
  "1": [
    { id: "1-1", from: "client", text: "Ola, tenho interesse no Evora." },
    {
      id: "1-2",
      from: "ana",
      text: "Perfeito. Posso mostrar as opcoes de pagamento e agendar uma visita ainda hoje.",
    },
  ],
  "2": [
    { id: "2-1", from: "client", text: "Conseguimos confirmar a visita para amanha?" },
    { id: "2-2", from: "ana", text: "Claro. Posso validar o melhor horario para voce." },
  ],
  "3": [
    { id: "3-1", from: "client", text: "Recebi a proposta e quero tirar algumas duvidas." },
    { id: "3-2", from: "ana", text: "Combinado. Posso detalhar as condicoes de pagamento." },
  ],
  "4": [
    { id: "4-1", from: "client", text: "Quero entender melhor o financiamento." },
    {
      id: "4-2",
      from: "ana",
      text: "Posso te enviar um resumo dos proximos passos para aprovacao.",
    },
  ],
};

export const CONVERSATION_FALLBACK_MOCK: Conversation = {
  id: "-",
  clientName: "Cliente",
  enterpriseName: "Empreendimento",
  lastMessage: "Sem mensagem recente.",
  status: "ANA",
  needsHuman: false,
  unread: false,
  assignedBrokerName: "Corretor",
};
