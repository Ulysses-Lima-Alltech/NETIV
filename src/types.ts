export type ConversationStatus = 'NOVO' | 'EM_ANDAMENTO' | 'QUALIFICADO' | 'HANDOFF' | 'Novo' | 'Qualificado' | 'Carteira' | 'Handoff';

export type LeadTemperatura = 'quente' | 'morno' | 'frio';

export interface Conversation {
  id: string;
  /** Título na lista lateral: perfil WhatsApp, senão nome confirmado, senão telefone. */
  leadName: string;
  /** Nome que o cliente informou na conversa (cabeçalho do chat; não usar perfil WA). */
  confirmedCustomerName?: string | null;
  leadPhone: string;
  lastMessage: string;
  updatedAt: string; // ISO date
  unreadCount: number;
  status: ConversationStatus;
  empreendimento: string | null;
  /** null = temperatura ainda não definida (Modelo B). */
  temperatura: LeadTemperatura | null;
  /** ID do projeto (backend). */
  projectId?: number | null;
  /** Nome do projeto para exibição (pode ser de projeto inativo). */
  projectName?: string | null;
  classificationStatus?: string;
  /** true = atendimento humano (ANA não responde), false = ANA responde. */
  handoff?: boolean;
  /** Empreendimento da origem/campanha (imutável); pode diferir do ativo. */
  enterpriseOriginId?: number | null;
  enterpriseOriginName?: string | null;
  /** Segmentação quando em Carteira (API camelCase). */
  reserveReason?: string | null;
  reserveDesiredCity?: string | null;
  reservePriceMin?: number | null;
  reservePriceMax?: number | null;
  reservePropertyType?: string | null;
  reserveBedrooms?: number | null;
  reserveInterestType?: string | null;
  reserveFollowUpMoment?: string | null;
  reserveCommercialNotes?: string | null;
  /** Corretor atribuído no handoff (tag). */
  assignedBrokerName?: string | null;
  /** ID do corretor fixo da conversa (prioridade sobre distribuição automática). */
  assignedBrokerId?: number | null;
  whatsappWindow?: {
    isOpen: boolean;
    lastInboundAt: string | null;
    closesAt: string | null;
    reason: 'open' | 'no_inbound' | 'expired';
  };
}

export type MessageSender = 'LEAD' | 'AGENT';

export interface Message {
  id: string;
  conversationId: string;
  sender: MessageSender;
  text: string;
  createdAt: string; // ISO date
}
