const API_BASE = '/api';

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

export interface ProjectItem {
  id: number;
  name: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export const projectsApi = {
  list: (activeOnly = true) =>
    request<{ projects: ProjectItem[] }>(`/projects${activeOnly ? '?active=1' : ''}`),
  create: (name: string) =>
    request<ProjectItem>('/projects', { method: 'POST', body: { name: name.trim() } }),
  update: (id: number, body: { name?: string; active?: boolean }) =>
    request<ProjectItem>(`/projects/${id}`, { method: 'PATCH', body }),
  delete: (id: number) =>
    request<ProjectItem>(`/projects/${id}`, { method: 'DELETE' }),
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
