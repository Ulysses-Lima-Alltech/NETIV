const API_BASE =
  import.meta.env.VITE_API_URL != null && String(import.meta.env.VITE_API_URL).trim() !== ''
    ? `${String(import.meta.env.VITE_API_URL).replace(/\/$/, '')}/api`
    : '/api';

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; headers?: Record<string, string> } = {}
): Promise<T> {
  const { method = 'GET', body, headers = {} } = options;
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Erro ${res.status}`);
  return data as T;
}

export interface WhatsAppConfigPublic {
  metaAccessTokenMasked: boolean;
  whatsappPhoneNumberId: string;
  whatsappBusinessAccountId: string;
  apiVersion: string;
  webhookVerifyTokenMasked: boolean;
  defaultSendPhoneNumber: string | null;
  defaultCountryCode: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WhatsAppConfigUpdate {
  metaAccessToken?: string;
  whatsappPhoneNumberId?: string;
  whatsappBusinessAccountId?: string;
  apiVersion?: string;
  webhookVerifyToken?: string;
  defaultSendPhoneNumber?: string | null;
  defaultCountryCode?: string | null;
  enabled?: boolean;
}

export interface ConversationListItem {
  id: string;
  channel: string;
  externalContactId: string;
  contactPhone: string | null;
  contactName: string | null;
  status: string;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  projectId: number | null;
  projectName: string | null;
  enterpriseId?: number | null;
  enterpriseName?: string | null;
  classificationStatus: string;
  leadStage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MessageListItem {
  id: string;
  conversationId: number;
  direction: 'inbound' | 'outbound';
  type: string;
  content: string | null;
  status: string;
  externalMessageId: string | null;
  createdAt: string;
}

export interface AIConfigPublic {
  openaiApiKeyMasked: boolean;
  openaiBaseUrl: string | null;
  modelColdLead: string;
  modelHotLead: string;
  temperature: number;
  maxTokens: number;
  leadScoreThreshold: number;
  aiEnabled: boolean;
  updatedAt: string;
}

export interface AIConfigUpdate {
  openaiApiKey?: string;
  openaiBaseUrl?: string | null;
  modelColdLead?: string;
  modelHotLead?: string;
  temperature?: number;
  maxTokens?: number;
  leadScoreThreshold?: number;
  aiEnabled?: boolean;
}

export const settingsApi = {
  getWhatsApp: () => request<WhatsAppConfigPublic>('/settings/integrations/whatsapp'),
  putWhatsApp: (body: WhatsAppConfigUpdate) =>
    request<WhatsAppConfigPublic>('/settings/integrations/whatsapp', { method: 'PUT', body }),
  testWhatsApp: () =>
    request<{ success: boolean; message?: string; error?: string; detail?: string }>('/settings/integrations/whatsapp/test', { method: 'POST' }),
  getAI: () => request<AIConfigPublic>('/settings/ai'),
  putAI: (body: AIConfigUpdate) =>
    request<AIConfigPublic>('/settings/ai', { method: 'PUT', body }),
};

export const whatsappApi = {
  send: (to: string, message: string) =>
    request<{ success: boolean; metaMessageId?: string; conversationId?: number }>('/whatsapp/send', {
      method: 'POST',
      body: { to, message },
    }),
  configCheck: () => request<{ configured: boolean }>('/whatsapp/config/check'),
  getConversations: (params?: { channel?: string; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.channel) q.set('channel', params.channel);
    if (params?.limit != null) q.set('limit', String(params.limit));
    const query = q.toString();
    return request<{ conversations: ConversationListItem[] }>(`/whatsapp/conversations${query ? `?${query}` : ''}`);
  },
  getConversationMessages: (conversationId: number) =>
    request<{ conversationId: number; messages: MessageListItem[] }>(`/whatsapp/conversations/${conversationId}/messages`),
  updateClassification: (conversationId: number, body: { project_id?: number | null; classification_status?: string }) =>
    request<{ id: number; projectId: number | null; projectName: string | null; classificationStatus: string }>(
      `/whatsapp/conversations/${conversationId}/classification`,
      { method: 'PATCH', body }
    ),
  sendToConversation: (conversationId: number, message: string) =>
    request<{ success: boolean; metaMessageId?: string }>(`/whatsapp/conversations/${conversationId}/send`, {
      method: 'POST',
      body: { message },
    }),
};

export type FileCategory = 'book' | 'unidades' | 'tabela_comercial' | 'outro';

export interface ProjectVariables {
  priceLabel?: string;
  commercialConditions?: string;
  availability?: string;
  observations?: string;
  /** @deprecated compat */
  notes?: string;
}

export interface KnowledgeFileItem {
  id: number;
  category: FileCategory;
  originalName: string;
  mime: string;
  size: number;
  isActive?: boolean;
  createdAt: string;
}

export interface EmpreendimentoDTO {
  id: number;
  slug: string;
  name: string;
  status: 'ativo' | 'inativo';
  languageStyle: 'informal' | 'natural' | 'formal' | 'culta';
  variables: ProjectVariables;
  promptAddons: string[];
  createdAt: string;
  updatedAt: string;
  knowledgeFiles?: KnowledgeFileItem[];
}

export type ProjectListItem = Omit<EmpreendimentoDTO, 'knowledgeFiles'>;

export const projectsApi = {
  list: (activeOnly = true) =>
    request<{ projects: ProjectListItem[] }>(`/projects${activeOnly ? '?active=1' : ''}`),
  get: (id: number) =>
    request<EmpreendimentoDTO & { knowledgeFiles: KnowledgeFileItem[] }>(`/projects/${id}`),
  create: (body: { name: string; slug?: string; languageStyle?: EmpreendimentoDTO['languageStyle'] }) =>
    request<ProjectListItem>('/projects', { method: 'POST', body }),
  update: (
    id: number,
    body: {
      name?: string;
      status?: 'ativo' | 'inativo';
      slug?: string;
      languageStyle?: EmpreendimentoDTO['languageStyle'];
      variables?: ProjectVariables;
      promptAddons?: string[];
    }
  ) => request<ProjectListItem>(`/projects/${id}`, { method: 'PATCH', body }),
  delete: (id: number) => request<ProjectListItem>(`/projects/${id}`, { method: 'DELETE' }),
  uploadKnowledge: async (projectId: number, file: File, category: FileCategory): Promise<KnowledgeFileItem> => {
    const fd = new FormData();
    fd.append('category', category);
    fd.append('file', file);
    const res = await fetch(`${API_BASE}/projects/${projectId}/knowledge`, { method: 'POST', body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data as { error?: string }).error ?? `Erro ${res.status}`);
    return data as KnowledgeFileItem;
  },
  deleteKnowledge: (projectId: number, fileId: number) =>
    request<{ ok: boolean }>(`/projects/${projectId}/knowledge/${fileId}`, { method: 'DELETE' }),
};

export interface LeadAnalysisResponse {
  leadScore: number;
  leadStage: string;
  leadIntentNow: string;
  reason: string;
}

export const leadApi = {
  analyze: (messages: string[]) =>
    request<LeadAnalysisResponse>('/lead/analyze', { method: 'POST', body: { messages } }),
};
