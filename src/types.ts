export type ConversationStatus = 'NOVO' | 'EM_ANDAMENTO' | 'QUALIFICADO' | 'HANDOFF' | 'Novo' | 'Qualificado' | 'Carteira' | 'Handoff';

export type LeadTemperatura = 'quente' | 'morno' | 'frio';

export interface Conversation {
  id: string;
  /** Título na lista lateral: perfil WhatsApp, senão nome confirmado, senão telefone. */
  leadName: string;
  /** Nome que o cliente informou na conversa (cabeçalho do chat; não usar perfil WA). */
  confirmedCustomerName?: string | null;
  /** URL da foto do perfil WhatsApp (quando disponível no payload). */
  avatarUrl?: string | null;
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
  /** Encerramento manual pelo inbox — bloqueia reengajamento automático da Ana. */
  manualClosedAt?: string | null;
  manualClosedByUserId?: number | null;
  manualClosedReason?: string | null;
  /** Contador de reengajamentos automáticos (backend). */
  reengagementCount?: number;
}

export type MessageSender = 'LEAD' | 'AGENT';

export interface MessageAttachment {
  fileName: string;
  mimeType: string;
  sizeBytes?: number;
  whatsappMediaId?: string | null;
  caption?: string | null;
  enterpriseFileId?: number | null;
}

export interface Message {
  id: string;
  conversationId: string;
  sender: MessageSender;
  text: string;
  createdAt: string; // ISO date
  /** document | image quando envio com arquivo */
  messageType?: 'text' | 'document' | 'image';
  attachment?: MessageAttachment | null;
  /** true quando a mensagem foi apagada internamente (soft delete NETIV) */
  deleted?: boolean;
  deletedAt?: string | null;
}
