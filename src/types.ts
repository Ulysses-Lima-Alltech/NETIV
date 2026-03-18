export type ConversationStatus = 'NOVO' | 'EM_ANDAMENTO' | 'QUALIFICADO' | 'HANDOFF' | 'Novo' | 'Handoff';

export type LeadTemperatura = 'quente' | 'morno' | 'frio';

export interface Conversation {
  id: string;
  leadName: string;
  leadPhone: string;
  lastMessage: string;
  updatedAt: string; // ISO date
  unreadCount: number;
  status: ConversationStatus;
  empreendimento: string | null;
  temperatura: LeadTemperatura;
  /** ID do projeto (backend). */
  projectId?: number | null;
  /** Nome do projeto para exibição (pode ser de projeto inativo). */
  projectName?: string | null;
  classificationStatus?: string;
}

export type MessageSender = 'LEAD' | 'AGENT';

export interface Message {
  id: string;
  conversationId: string;
  sender: MessageSender;
  text: string;
  createdAt: string; // ISO date
}
