import type {
  BatchTemplateCatalogItem,
  BatchParseResponse,
  BatchPreviewResponse,
  BatchTestResult,
  BatchSendResult,
} from '../types/whatsappBatch';

/** Base da API: com VITE_API_URL (ex.: https://api.exemplo.com) → `${VITE_API_URL}/api`; sem variável → `/api` (mesmo host; em dev o Vite proxy encaminha para o backend). */
const API_BASE =
  import.meta.env.VITE_API_URL != null && String(import.meta.env.VITE_API_URL).trim() !== ''
    ? `${String(import.meta.env.VITE_API_URL).replace(/\/$/, '')}/api`
    : '/api';

const AUTH_TOKEN_KEY = 'auth_token';

export function getStoredAuthToken(): string | null {
  return localStorage.getItem(AUTH_TOKEN_KEY);
}

export function setStoredAuthToken(token: string | null): void {
  if (token == null) localStorage.removeItem(AUTH_TOKEN_KEY);
  else localStorage.setItem(AUTH_TOKEN_KEY, token);
}

export class ApiError extends Error {
  code?: string;
  status?: number;
}

/** Bypass temporário: 401 só limpa token local; sem redirect para /login. */
function handleUnauthorized(): void {
  setStoredAuthToken(null);
}

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; headers?: Record<string, string> } = {}
): Promise<T> {
  const { method = 'GET', body, headers = {} } = options;
  const token = getStoredAuthToken();
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    const isLoginFailure = path === '/auth/login' && method === 'POST';
    if (isLoginFailure) {
      throw new Error((data as { error?: string }).error ?? 'E-mail ou senha incorretos.');
    }
    handleUnauthorized();
    throw new Error((data as { error?: string }).error ?? 'Sessão expirada. Faça login novamente.');
  }
  if (!res.ok) {
    const payload = data as { error?: string; code?: string };
    const err = new ApiError(payload.error ?? `Erro ${res.status}`);
    err.code = payload.code;
    err.status = res.status;
    throw err;
  }
  return data as T;
}

async function requestFormData<T>(path: string, formData: FormData): Promise<T> {
  const token = getStoredAuthToken();
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: formData,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    handleUnauthorized();
    throw new Error((data as { error?: string }).error ?? 'Sessão expirada. Faça login novamente.');
  }
  if (!res.ok) {
    const payload = data as { error?: string; code?: string };
    const err = new ApiError(payload.error ?? `Erro ${res.status}`);
    err.code = payload.code;
    err.status = res.status;
    throw err;
  }
  return data as T;
}

/** Manter alinhado a `ALL_APP_USER_ROLES` em `server/constants/roles.ts`. */
export type UserRole = 'ADMIN' | 'COLLABORATOR' | 'MANAGERIAL';

export function userRoleLabel(role: UserRole): string {
  switch (role) {
    case 'ADMIN':
      return 'Administrador';
    case 'MANAGERIAL':
      return 'Gerencial';
    case 'COLLABORATOR':
      return 'Colaborador';
    default: {
      const _exhaustive: never = role;
      return _exhaustive;
    }
  }
}

export interface AuthUser {
  id: number;
  name: string;
  email: string;
  role: UserRole;
}

/** Usuário mock estável para bypass temporário de auth (sem chamadas à API de login). */
export const AUTH_BYPASS_MOCK_USER: AuthUser = {
  id: 0,
  name: 'Dev (bypass)',
  email: 'dev@local',
  role: 'ADMIN',
};

export const authApi = {
  login: (_email: string, _password: string) =>
    Promise.resolve({ token: '', user: AUTH_BYPASS_MOCK_USER }),
  me: () => Promise.resolve({ user: AUTH_BYPASS_MOCK_USER }),
  logout: () => Promise.resolve({ ok: true as const }),
};

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

export interface WhatsAppMetaTemplateItem {
  id?: string;
  name?: string;
  language?: string;
  status?: string;
  category?: string;
  created_time?: string;
  updated_time?: string;
  source?: 'meta' | 'local_fallback';
  components?: Array<Record<string, unknown>>;
}

export interface ConversationListItem {
  id: string;
  channel: string;
  externalContactId: string;
  contactPhone: string | null;
  contactName: string | null;
  /** Nome de perfil WhatsApp (listagem). */
  whatsappDisplayName?: string | null;
  /** Nome confirmado pelo cliente na conversa. */
  customerName?: string | null;
  status: string;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  projectId: number | null;
  projectName: string | null;
  enterpriseId?: number | null;
  enterpriseName?: string | null;
  classificationStatus: string;
  leadStage: string | null;
  handoff?: boolean;
  /** Empreendimento da campanha/origem (histórico). */
  enterpriseOriginId?: number | null;
  /** Snapshot bruto (ex.: referral Meta) quando existir. */
  leadSourceRaw?: unknown | null;
  createdAt: string;
  updatedAt: string;
  reserveReason?: string | null;
  reserveDesiredCity?: string | null;
  reservePriceMin?: number | null;
  reservePriceMax?: number | null;
  reservePropertyType?: string | null;
  reserveBedrooms?: number | null;
  reserveInterestType?: string | null;
  reserveFollowUpMoment?: string | null;
  reserveCommercialNotes?: string | null;
  assignedBrokerName?: string | null;
  assignedBrokerId?: number | null;
  manualClosedAt?: string | null;
  manualClosedByUserId?: number | null;
  manualClosedReason?: string | null;
  reengagementCount?: number;
  conversationType?: 'CLIENT' | 'INTERNO' | string;
}

/** Corpo parcial para PATCH de classificação + segmentação Carteira. */
export interface ReserveSegmentationPatchBody {
  reason?: string | null;
  desiredCity?: string | null;
  desiredPriceMin?: number | null;
  desiredPriceMax?: number | null;
  propertyType?: string | null;
  bedrooms?: number | null;
  interestType?: string | null;
  followUpMoment?: string | null;
  commercialNotes?: string | null;
}

export interface MessageAttachmentDto {
  fileName?: string;
  mimeType?: string;
  sizeBytes?: number;
  whatsappMediaId?: string | null;
  caption?: string | null;
  enterpriseFileId?: number | null;
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
  attachment?: MessageAttachmentDto | null;
  /** Soft delete interno NETIV */
  deleted?: boolean;
  deletedAt?: string | null;
  deleteScope?: string | null;
}

export interface WhatsAppWindowStatus {
  isOpen: boolean;
  lastInboundAt: string | null;
  closesAt: string | null;
  reason: 'open' | 'no_inbound' | 'expired';
}

export interface AIConfigPublic {
  openaiApiKeyMasked: boolean;
  openaiApiKeyId?: string | null;
  openaiProjectId?: string | null;
  openaiBaseUrl: string | null;
  modelColdLead: string;
  modelHotLead: string;
  temperature: number;
  maxTokens: number;
  leadScoreThreshold: number;
  aiEnabled: boolean;
  updatedAt: string;
  availableModels?: Array<{
    value: string;
    label: string;
    description: string;
    recommendedFor: 'hot' | 'cold' | 'advanced' | 'realtime';
    costTier?: 'muito baixo' | 'baixo' | 'médio' | 'médio/alto' | 'alto' | 'variável';
    costHint?: string;
  }>;
}

export interface AIConfigUpdate {
  openaiApiKey?: string;
  removeApiKey?: boolean;
  openaiApiKeyId?: string | null;
  openaiProjectId?: string | null;
  openaiBaseUrl?: string | null;
  modelColdLead?: string;
  modelHotLead?: string;
  temperature?: number;
  maxTokens?: number;
  leadScoreThreshold?: number;
  aiEnabled?: boolean;
}

export type ApiKeySource = 'enterprise' | 'global_fallback';

export interface ApiGlobalSettingsPublic {
  provider: 'openai';
  has_api_key: boolean;
  masked_api_key: string | null;
  openai_api_key_id: string | null;
  openai_project_id: string | null;
  openai_base_url: string | null;
  model_hot_lead: string | null;
  model_cold_lead: string | null;
  ai_enabled: boolean;
  temperature: number;
  max_tokens: number;
  lead_score_threshold: number;
  available_models?: Array<{
    value: string;
    label: string;
    description: string;
    recommendedFor: 'hot' | 'cold' | 'advanced' | 'realtime';
    costTier?: 'muito baixo' | 'baixo' | 'médio' | 'médio/alto' | 'alto' | 'variável';
    costHint?: string;
  }>;
}

export interface ApiGlobalSettingsUpdate {
  provider?: 'openai';
  use_global_defaults?: boolean;
  openai_api_key?: string;
  remove_api_key?: boolean;
  openai_api_key_id?: string | null;
  openai_project_id?: string | null;
  openai_base_url?: string | null;
  model_hot_lead?: string | null;
  model_cold_lead?: string | null;
  ai_enabled?: boolean;
  temperature?: number;
  max_tokens?: number;
  lead_score_threshold?: number;
}

export interface EnterpriseApiSettingsItem {
  enterprise_id: number;
  enterprise_name: string;
  provider: 'openai';
  use_global_defaults: boolean;
  has_own_api_key: boolean;
  masked_api_key: string | null;
  openai_api_key_id: string | null;
  openai_project_id: string | null;
  openai_base_url: string | null;
  model_hot_lead: string | null;
  model_cold_lead: string | null;
  effective_model_hot_lead: string;
  effective_model_cold_lead: string;
  ai_enabled: boolean;
  emergency_block_enabled: boolean;
  emergency_block_message: string | null;
  cost_tracking_enabled: boolean;
  last_connection_test_at: string | null;
  last_connection_test_status: string | null;
  last_connection_test_error: string | null;
  api_key_source_preview: ApiKeySource | null;
}

export interface EnterpriseApiSettingsUpdate {
  provider?: 'openai';
  use_global_defaults?: boolean;
  openai_api_key?: string;
  remove_api_key?: boolean;
  openai_api_key_id?: string | null;
  openai_project_id?: string | null;
  openai_base_url?: string | null;
  model_hot_lead?: string | null;
  model_cold_lead?: string | null;
  ai_enabled?: boolean;
  emergency_block_enabled?: boolean;
  emergency_block_message?: string | null;
  cost_tracking_enabled?: boolean;
}

export interface EnterpriseApiConnectionTestResult {
  success: boolean;
  blocked: boolean;
  reason: string | null;
  model: string | null;
  baseUrl: string | null;
  apiKeySource: ApiKeySource | null;
  openaiApiKeyId: string | null;
  openaiProjectId: string | null;
  reply?: string;
  error?: string | null;
}

export interface OpenAiCostSettingsPublic {
  provider: 'openai';
  has_api_key: boolean;
  masked_api_key: string | null;
  openai_costs_api_key_id: string | null;
  openai_project_id: string | null;
  enabled: boolean;
  last_sync_at: string | null;
  last_sync_status: string | null;
  last_sync_error: string | null;
  updated_at: string;
}

export interface OpenAiCostSettingsUpdate {
  provider?: 'openai';
  openai_costs_api_key?: string;
  remove_api_key?: boolean;
  openai_costs_api_key_id?: string | null;
  openai_project_id?: string | null;
  enabled?: boolean;
}

export interface OpenAiCostSettingsTestResult {
  success: boolean;
  status: number;
  message: string;
  baseUrl: string;
  openaiProjectId: string | null;
}

export interface OpenAiCostSyncResult {
  syncedRows: number;
  savedRows: number;
  unknownApiKeyRows: number;
  source: 'openai_costs_api';
  startTime: string;
  endTime: string;
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
  getApiGlobal: () => request<ApiGlobalSettingsPublic>('/settings/api/global'),
  putApiGlobal: (body: ApiGlobalSettingsUpdate) =>
    request<ApiGlobalSettingsPublic>('/settings/api/global', { method: 'PUT', body }),
  getApiEnterprises: () =>
    request<{
      enterprises: EnterpriseApiSettingsItem[];
      available_models?: Array<{
        value: string;
        label: string;
        description: string;
        recommendedFor: 'hot' | 'cold' | 'advanced' | 'realtime';
        costTier?: 'muito baixo' | 'baixo' | 'médio' | 'médio/alto' | 'alto' | 'variável';
        costHint?: string;
      }>;
    }>('/settings/api/enterprises'),
  putApiEnterprise: (enterpriseId: number, body: EnterpriseApiSettingsUpdate) =>
    request<EnterpriseApiSettingsItem>(`/settings/api/enterprises/${enterpriseId}`, {
      method: 'PUT',
      body,
    }),
  testApiEnterprise: (enterpriseId: number) =>
    request<EnterpriseApiConnectionTestResult>(`/settings/api/enterprises/${enterpriseId}/test`, {
      method: 'POST',
    }),
  getOpenAiCostsConfig: () =>
    request<OpenAiCostSettingsPublic>('/settings/api/costs/config'),
  putOpenAiCostsConfig: (body: OpenAiCostSettingsUpdate) =>
    request<OpenAiCostSettingsPublic>('/settings/api/costs/config', { method: 'PUT', body }),
  testOpenAiCostsConfig: () =>
    request<OpenAiCostSettingsTestResult>('/settings/api/costs/config/test', { method: 'POST' }),
  syncOpenAiCosts: (body?: { startTime?: string; endTime?: string }) =>
    request<OpenAiCostSyncResult>('/settings/api/costs/sync', { method: 'POST', body: body ?? {} }),
};

export const whatsappApi = {
  send: (to: string, message: string, options?: { templateKey?: string }) =>
    request<{ success: boolean; metaMessageId?: string; conversationId?: number }>('/whatsapp/send', {
      method: 'POST',
      body: options?.templateKey ? { to, templateKey: options.templateKey } : { to, message },
    }),
  configCheck: () => request<{ configured: boolean }>('/whatsapp/config/check'),
  listTemplates: () => request<{ templates: WhatsAppMetaTemplateItem[]; source?: string }>('/whatsapp/templates'),
  createTemplate: (body: {
    name: string;
    category: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';
    language?: string;
    body: string;
    headerText?: string;
    footerText?: string;
  }) =>
    request<{ success: boolean; result?: unknown; error?: string }>('/whatsapp/templates', {
      method: 'POST',
      body,
    }),
  deleteTemplate: (name: string) =>
    request<{ success: boolean; result?: unknown; error?: string }>(`/whatsapp/templates/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    }),
  syncTemplates: () =>
    request<{ success: boolean; templates?: BatchTemplateCatalogItem[]; fallbackUsed?: boolean; error?: string }>(
      '/whatsapp/templates/sync',
      { method: 'POST' }
    ),
  getConversations: (params?: {
    channel?: string;
    limit?: number;
    mode?: 'all' | 'ANA' | 'handoff';
    status?: string;
    enterpriseId?: number;
    search?: string;
    type?: 'CLIENT' | 'INTERNO';
  }) => {
    const q = new URLSearchParams();
    if (params?.channel) q.set('channel', params.channel);
    if (params?.limit != null) q.set('limit', String(params.limit));
    if (params?.mode && params.mode !== 'all') q.set('mode', params.mode);
    if (params?.status && params.status !== 'all') q.set('status', params.status);
    if (params?.enterpriseId != null) q.set('enterpriseId', String(params.enterpriseId));
    if (params?.search?.trim()) q.set('search', params.search.trim());
    if (params?.type) q.set('type', params.type);
    const query = q.toString();
    return request<{ conversations: ConversationListItem[] }>(`/whatsapp/conversations${query ? `?${query}` : ''}`);
  },
  /** Detalhe de uma conversa (mesmo formato de um item da listagem) — deep link / inbox. */
  getConversation: (conversationId: number) =>
    request<ConversationListItem>(`/whatsapp/conversations/${conversationId}`),
  getConversationMessages: (conversationId: number) =>
    request<{ conversationId: number; window?: WhatsAppWindowStatus; messages: MessageListItem[] }>(
      `/whatsapp/conversations/${conversationId}/messages`
    ),
  updateClassification: (
    conversationId: number,
    body: {
      project_id?: number | null;
      classification_status?: string;
      handoff?: boolean;
      lead_temperature?: 'quente' | 'morno' | 'frio';
      reserve?: ReserveSegmentationPatchBody;
      assigned_broker_id?: number | null;
    }
  ) =>
    request<{
      id: number;
      projectId: number | null;
      projectName: string | null;
      enterpriseOriginId?: number | null;
      enterpriseOriginName?: string | null;
      leadSourceRaw?: unknown | null;
      classificationStatus: string;
      leadStage?: string | null;
      handoff?: boolean;
      assignedBrokerId?: number | null;
      assignedBrokerName?: string | null;
      reserveReason?: string | null;
      reserveDesiredCity?: string | null;
      reservePriceMin?: number | null;
      reservePriceMax?: number | null;
      reservePropertyType?: string | null;
      reserveBedrooms?: number | null;
      reserveInterestType?: string | null;
      reserveFollowUpMoment?: string | null;
      reserveCommercialNotes?: string | null;
    }>(`/whatsapp/conversations/${conversationId}/classification`, { method: 'PATCH', body }),
  sendToConversation: (conversationId: number, message: string, file?: File | null) => {
    if (file) {
      const fd = new FormData();
      if (message.trim()) fd.append('message', message.trim());
      fd.append('file', file);
      return requestFormData<{ success: boolean; metaMessageId?: string; messageKind?: string }>(
        `/whatsapp/conversations/${conversationId}/send`,
        fd
      );
    }
    return request<{ success: boolean; metaMessageId?: string }>(`/whatsapp/conversations/${conversationId}/send`, {
      method: 'POST',
      body: { message },
    });
  },
  updateCustomerName: (conversationId: number, name: string | null) =>
    request<{ success: boolean; conversationId: number; customerName: string | null }>(
      `/whatsapp/conversations/${conversationId}/customer-name`,
      { method: 'PATCH', body: { name } },
    ),
  deleteMessage: (conversationId: number, messageId: string) =>
    request<{ success: boolean; messageId: string }>(
      `/whatsapp/conversations/${conversationId}/messages/${messageId}`,
      { method: 'DELETE' },
    ),
  deleteConversation: (conversationId: number) =>
    request<{ success: boolean }>(`/whatsapp/conversations/${conversationId}`, { method: 'DELETE' }),
  deleteAllByPhone: (phone: string) =>
    request<{ success: boolean; deletedCount: number }>(
      `/whatsapp/conversations/by-phone/${encodeURIComponent(phone)}`,
      { method: 'DELETE' }
    ),
  resetConversation: (conversationId: number) =>
    request<{ success: boolean; conversationId: number }>(
      `/whatsapp/conversations/${conversationId}/reset`,
      { method: 'POST' }
    ),
  closeConversation: (conversationId: number, body?: { reason?: string | null }) =>
    request<{ success: boolean; conversationId: number; manualClosedAt: string | null }>(
      `/whatsapp/conversations/${conversationId}/close`,
      { method: 'PATCH', body: body ?? {} }
    ),
  reopenConversation: (conversationId: number) =>
    request<{ success: boolean; conversationId: number; manualClosedAt: null }>(
      `/whatsapp/conversations/${conversationId}/reopen`,
      { method: 'PATCH', body: {} }
    ),
};

export interface ContactListItem {
  id: number;
  fullName: string | null;
  firstName?: string | null;
  phoneE164: string;
  phoneDisplay?: string | null;
  email?: string | null;
  /** ID do empreendimento cadastrado (quando vínculo canônico existe). */
  enterpriseId?: number | null;
  /** Nome para exibição (JOIN ou texto legado). */
  enterpriseInterest?: string | null;
  notes?: string | null;
  source?: string;
  ownerUserId: number | null;
  ownerName?: string | null;
  status: 'assigned' | 'unassigned';
  lastContactAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ContactImportPreview {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicateRows: number;
  createdContacts: number;
  updatedContacts: number;
  claimedUnassignedContacts: number;
  skippedOwnedContacts: number;
  rows: Array<{
    rowNumber: number;
    action: string;
    normalizedPhoneE164: string | null;
    errorMessage: string | null;
  }>;
}

export const contactsApi = {
  list: (params?: {
    search?: string;
    enterprise?: string;
    enterpriseId?: number;
    ownerUserId?: number;
    brokerId?: number;
    status?: 'assigned' | 'unassigned';
    origin?: string;
    createdFrom?: string;
    createdTo?: string;
    lastContactFrom?: string;
    lastContactTo?: string;
    withoutBroker?: boolean;
    withoutEnterprise?: boolean;
    page?: number;
    pageSize?: number;
  }) => {
    const q = new URLSearchParams();
    if (params?.search?.trim()) q.set('search', params.search.trim());
    if (params?.enterprise?.trim()) q.set('enterprise', params.enterprise.trim());
    if (params?.enterpriseId != null) q.set('enterpriseId', String(params.enterpriseId));
    if (params?.ownerUserId != null) q.set('ownerUserId', String(params.ownerUserId));
    if (params?.brokerId != null) q.set('brokerId', String(params.brokerId));
    if (params?.status) q.set('status', params.status);
    if (params?.origin?.trim()) q.set('origin', params.origin.trim());
    if (params?.createdFrom) q.set('createdFrom', params.createdFrom);
    if (params?.createdTo) q.set('createdTo', params.createdTo);
    if (params?.lastContactFrom) q.set('lastContactFrom', params.lastContactFrom);
    if (params?.lastContactTo) q.set('lastContactTo', params.lastContactTo);
    if (params?.withoutBroker === true) q.set('withoutBroker', 'true');
    if (params?.withoutEnterprise === true) q.set('withoutEnterprise', 'true');
    if (params?.page != null) q.set('page', String(params.page));
    if (params?.pageSize != null) q.set('pageSize', String(params.pageSize));
    const path = `/contacts${q.toString() ? `?${q.toString()}` : ''}`;
    if (import.meta.env.DEV) {
      console.debug('[contactsApi.list] query params', params);
      console.debug('[contactsApi.list] request path', path);
    }
    return request<{ contacts: ContactListItem[]; page: number; pageSize: number; total: number }>(path);
  },
  exportCsv: async (params?: {
    search?: string;
    enterprise?: string;
    enterpriseId?: number;
    ownerUserId?: number;
    brokerId?: number;
    status?: 'assigned' | 'unassigned';
    origin?: string;
    createdFrom?: string;
    createdTo?: string;
    lastContactFrom?: string;
    lastContactTo?: string;
    withoutBroker?: boolean;
    withoutEnterprise?: boolean;
  }) => {
    const q = new URLSearchParams();
    if (params?.search?.trim()) q.set('search', params.search.trim());
    if (params?.enterprise?.trim()) q.set('enterprise', params.enterprise.trim());
    if (params?.enterpriseId != null) q.set('enterpriseId', String(params.enterpriseId));
    if (params?.ownerUserId != null) q.set('ownerUserId', String(params.ownerUserId));
    if (params?.brokerId != null) q.set('brokerId', String(params.brokerId));
    if (params?.status) q.set('status', params.status);
    if (params?.origin?.trim()) q.set('origin', params.origin.trim());
    if (params?.createdFrom) q.set('createdFrom', params.createdFrom);
    if (params?.createdTo) q.set('createdTo', params.createdTo);
    if (params?.lastContactFrom) q.set('lastContactFrom', params.lastContactFrom);
    if (params?.lastContactTo) q.set('lastContactTo', params.lastContactTo);
    if (params?.withoutBroker === true) q.set('withoutBroker', 'true');
    if (params?.withoutEnterprise === true) q.set('withoutEnterprise', 'true');
    if (import.meta.env.DEV) {
      console.debug('[contactsApi.exportCsv] query params', params);
    }
    const token = getStoredAuthToken();
    const res = await fetch(`${API_BASE}/contacts/export${q.toString() ? `?${q.toString()}` : ''}`, {
      method: 'GET',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (res.status === 401) {
      handleUnauthorized();
      throw new Error('Sessão expirada. Faça login novamente.');
    }
    if (!res.ok) {
      let msg = `Erro ${res.status}`;
      try {
        const data = await res.json();
        msg = (data as { error?: string }).error ?? msg;
      } catch {
        // noop
      }
      throw new Error(msg);
    }
    const blob = await res.blob();
    const disposition = res.headers.get('content-disposition') ?? '';
    const filenameMatch = disposition.match(/filename="([^"]+)"/i);
    const filename = filenameMatch?.[1] ?? 'leads_netiv.csv';
    return { blob, filename };
  },
  filterOptions: () => request<{ origins: string[] }>('/contacts/filter-options'),
  get: (id: number) => request<ContactListItem>(`/contacts/${id}`),
  update: (
    id: number,
    body: {
      fullName?: string;
      email?: string;
      enterpriseId?: number | null;
      enterpriseInterest?: string;
      notes?: string;
      source?: string;
    }
  ) => request<{ success: boolean }>(`/contacts/${id}`, { method: 'PATCH', body }),
  setOwner: (id: number, ownerUserId: number | null) =>
    request<{ success: boolean }>(`/contacts/${id}/owner`, {
      method: 'PATCH',
      body: { ownerUserId },
    }),
  importPreview: async (file: File, ownerUserId?: number | null) => {
    const fd = new FormData();
    fd.append('file', file);
    if (ownerUserId != null) fd.append('ownerUserId', String(ownerUserId));
    const token = getStoredAuthToken();
    const res = await fetch(`${API_BASE}/contacts/import/preview`, {
      method: 'POST',
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: fd,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new ApiError((data as { error?: string }).error ?? `Erro ${res.status}`);
      err.status = res.status;
      err.code = (data as { code?: string }).code;
      throw err;
    }
    return data as ContactImportPreview;
  },
  importCommit: async (file: File, ownerUserId?: number | null) => {
    const fd = new FormData();
    fd.append('file', file);
    if (ownerUserId != null) fd.append('ownerUserId', String(ownerUserId));
    const token = getStoredAuthToken();
    const res = await fetch(`${API_BASE}/contacts/import/commit`, {
      method: 'POST',
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: fd,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new ApiError((data as { error?: string }).error ?? `Erro ${res.status}`);
      err.status = res.status;
      err.code = (data as { code?: string }).code;
      throw err;
    }
    return data as { batchId: number; summary: ContactImportPreview };
  },
  listImportBatches: () => request<{ batches: Array<Record<string, unknown>> }>('/contacts/import/batches'),
  getBatchEligible: (batchId: number, ownerUserId: number) =>
    request<{ ownerUserId: number; blockedCount: number; contacts: ContactListItem[] }>(
      `/contacts/import/batches/${batchId}/eligible?ownerUserId=${ownerUserId}`
    ),
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
  /** Incluir texto extraído no contexto da Ana */
  canBeUsedAsKnowledge?: boolean;
  /** Permitir envio deste arquivo ao cliente via WhatsApp */
  canBeSentByAna?: boolean;
  createdAt: string;
}

export type EnterpriseTipo = 'LOTEAMENTO' | 'APARTAMENTO' | 'MCMV';

export interface EmpreendimentoDTO {
  id: number;
  slug: string;
  name: string;
  status: 'ativo' | 'inativo';
  languageStyle: 'informal' | 'natural' | 'formal' | 'culta';
  tipo: EnterpriseTipo;
  exclusivo: boolean;
  variables: ProjectVariables;
  promptAddons: string[];
  /** Localização cadastral */
  city?: string;
  stateUf?: string;
  commercialRegion?: string;
  /** Opcional; integrações / uso interno */
  ibgeCode?: string;
  createdAt: string;
  updatedAt: string;
  knowledgeFiles?: KnowledgeFileItem[];
}

export interface PromptAddonsHistoryItem {
  id: number;
  ruleText: string;
  createdAt: string;
  createdByUserId: number | null;
  createdByName: string | null;
}

export type ProjectListItem = Omit<EmpreendimentoDTO, 'knowledgeFiles'>;

export type ProjectListFilters = { tipo?: EnterpriseTipo; exclusivo?: boolean };

function defaultKnowledgeUploadFlags(category: FileCategory): {
  canBeUsedAsKnowledge: boolean;
  canBeSentByAna: boolean;
} {
  if (category === 'outro') return { canBeUsedAsKnowledge: true, canBeSentByAna: false };
  return { canBeUsedAsKnowledge: false, canBeSentByAna: true };
}

export const projectsApi = {
  list: (activeOnly = true, filters?: ProjectListFilters) => {
    const q = new URLSearchParams();
    if (activeOnly) q.set('active', '1');
    if (filters?.tipo) q.set('tipo', filters.tipo);
    if (filters?.exclusivo !== undefined) q.set('exclusivo', filters.exclusivo ? '1' : '0');
    const qs = q.toString();
    return request<{ projects: ProjectListItem[] }>(`/projects${qs ? `?${qs}` : ''}`);
  },
  get: (id: number) =>
    request<EmpreendimentoDTO & { knowledgeFiles: KnowledgeFileItem[] }>(`/projects/${id}`),
  create: (body: {
    name: string;
    slug?: string;
    languageStyle?: EmpreendimentoDTO['languageStyle'];
    tipo?: EnterpriseTipo;
    exclusivo?: boolean;
  }) => request<ProjectListItem>('/projects', { method: 'POST', body }),
  update: (
    id: number,
    body: {
      name?: string;
      status?: 'ativo' | 'inativo';
      slug?: string;
      languageStyle?: EmpreendimentoDTO['languageStyle'];
      tipo?: EnterpriseTipo;
      exclusivo?: boolean;
      variables?: ProjectVariables;
      promptAddons?: string[];
      city?: string;
      stateUf?: string;
      commercialRegion?: string;
      ibgeCode?: string;
    }
  ) => request<ProjectListItem>(`/projects/${id}`, { method: 'PATCH', body }),
  promptAddonsHistory: (id: number) =>
    request<{ items: PromptAddonsHistoryItem[] }>(`/projects/${id}/prompt-addons-history`),
  delete: (id: number) => request<ProjectListItem>(`/projects/${id}`, { method: 'DELETE' }),
  uploadKnowledge: async (
    projectId: number,
    file: File,
    category: FileCategory,
    opts?: { canBeUsedAsKnowledge?: boolean; canBeSentByAna?: boolean; tipoDocumento?: 'BOOK' }
  ): Promise<KnowledgeFileItem> => {
    const fd = new FormData();
    fd.append('category', category);
    if (opts?.tipoDocumento === 'BOOK') fd.append('tipoDocumento', 'BOOK');
    fd.append('file', file);
    const defaults = defaultKnowledgeUploadFlags(category);
    fd.append('canBeUsedAsKnowledge', String(opts?.canBeUsedAsKnowledge ?? defaults.canBeUsedAsKnowledge));
    fd.append('canBeSentByAna', String(opts?.canBeSentByAna ?? defaults.canBeSentByAna));
    const token = getStoredAuthToken();
    const res = await fetch(`${API_BASE}/projects/${projectId}/knowledge`, {
      method: 'POST',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: fd,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      setStoredAuthToken(null);
      throw new Error((data as { error?: string }).error ?? 'Sessão expirada. Faça login novamente.');
    }
    if (!res.ok) throw new Error((data as { error?: string }).error ?? `Erro ${res.status}`);
    return data as KnowledgeFileItem;
  },
  deleteKnowledge: (projectId: number, fileId: number) =>
    request<{
      ok: boolean;
      removed?: boolean;
      mode?: 'hard_deleted' | 'deactivated';
      deactivated?: boolean;
      message?: string;
      storageDeleteAttempted?: boolean;
      storageDeleted?: boolean;
      orphanedStorageKeys?: string[];
    }>(
      `/projects/${projectId}/knowledge/${fileId}`,
      { method: 'DELETE' }
    ),
  patchKnowledgeFile: (
    projectId: number,
    fileId: number,
    body: { canBeUsedAsKnowledge?: boolean; canBeSentByAna?: boolean }
  ) => request<KnowledgeFileItem>(`/projects/${projectId}/knowledge/${fileId}`, { method: 'PATCH', body }),
};

export interface Corretor {
  id: number;
  fullName: string;
  city: string;
  phone: string;
  realEstateAgency: string;
  active: boolean;
  enterpriseIds?: number[];
  createdAt: string;
  updatedAt: string;
}

export interface BrokerAvailability {
  id: number;
  weekday: number;
  startTime: string;
  endTime: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export const corretoresApi = {
  list: (params?: { enterpriseId?: number }) => {
    const q = params?.enterpriseId != null ? `?enterpriseId=${params.enterpriseId}` : '';
    return request<{ corretores: Corretor[] }>(`/corretores${q}`);
  },
  get: (id: number) => request<Corretor>(`/corretores/${id}`),
  create: (body: { fullName: string; city?: string; phone?: string; realEstateAgency?: string; enterpriseIds?: number[] }) =>
    request<Corretor>('/corretores', { method: 'POST', body }),
  update: (id: number, body: { fullName?: string; city?: string; phone?: string; realEstateAgency?: string; active?: boolean; enterpriseIds?: number[] }) =>
    request<Corretor>(`/corretores/${id}`, { method: 'PATCH', body }),
  inactivate: (id: number) =>
    request<Corretor>(`/corretores/${id}`, { method: 'DELETE' }),
  delete: (id: number) =>
    request<{ ok: boolean }>(`/corretores/${id}?permanent=1`, { method: 'DELETE' }),
  getAvailability: (brokerId: number) =>
    request<{ availability: BrokerAvailability[] }>(`/corretores/${brokerId}/availability`),
  createAvailability: (brokerId: number, body: { weekday: number; startTime: string; endTime: string; active?: boolean }) =>
    request<BrokerAvailability>(`/corretores/${brokerId}/availability`, { method: 'POST', body }),
  updateAvailability: (brokerId: number, availabilityId: number, body: { weekday?: number; startTime?: string; endTime?: string; active?: boolean }) =>
    request<BrokerAvailability>(`/corretores/${brokerId}/availability/${availabilityId}`, { method: 'PATCH', body }),
  deleteAvailability: (brokerId: number, availabilityId: number) =>
    request<{ ok: boolean }>(`/corretores/${brokerId}/availability/${availabilityId}`, { method: 'DELETE' }),
};

export interface Appointment {
  id: number;
  customerName: string;
  customerPhone: string;
  enterpriseId: number;
  brokerId: number | null;
  city: string;
  startAt: string;
  endAt: string;
  status: string;
  source: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface AssignAppointmentResult {
  appointment: Appointment;
  broker: { id: number; fullName: string; phone: string } | null;
  empreendimento: string | null;
  dataHora: string;
  cliente: string;
}

export const appointmentsApi = {
  list: (params?: { enterpriseId?: number; brokerId?: number; status?: string; date?: string }) => {
    const q = new URLSearchParams();
    if (params?.enterpriseId != null) q.set('enterpriseId', String(params.enterpriseId));
    if (params?.brokerId != null) q.set('brokerId', String(params.brokerId));
    if (params?.status) q.set('status', params.status);
    if (params?.date) q.set('date', params.date);
    const query = q.toString();
    return request<{ appointments: Appointment[] }>(`/appointments${query ? `?${query}` : ''}`);
  },
  get: (id: number) => request<Appointment>(`/appointments/${id}`),
  assign: (body: {
    customerName: string;
    customerPhone?: string;
    enterpriseId: number;
    brokerId?: number;
    city?: string;
    startAt: string;
    endAt: string;
    notes?: string;
    source?: string;
  }) => request<AssignAppointmentResult>('/appointments/assign', { method: 'POST', body }),
  checkAvailability: (body: { enterpriseId: number; city?: string; startAt: string; endAt: string }) =>
    request<{ available: boolean; eligibleBrokerCount: number; suggestedBrokerId?: number }>('/appointments/check-availability', { method: 'POST', body }),
  updateStatus: (id: number, status: string) =>
    request<Appointment>(`/appointments/${id}/status`, { method: 'PATCH', body: { status } }),
  cancel: (id: number) =>
    request<Appointment>(`/appointments/${id}/status`, { method: 'PATCH', body: { status: 'CANCELADO' } }),
  delete: (id: number) =>
    request<Record<string, never>>(`/appointments/${id}`, { method: 'DELETE' }),
  assignPending: (id: number, brokerId: number) =>
    request<{ appointment: Appointment; broker: { id: number; fullName: string; phone: string } }>(
      `/appointments/${id}/assign`,
      { method: 'POST', body: { brokerId } }
    ),
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

export type DashboardPeriod = 'today' | '7d' | '30d';

/** Filtro local da seção "Itens que exigem atenção" (`GET /dashboard/attention-items`). */
export type DashboardAttentionType =
  | 'all'
  | 'no_first_response'
  | 'novo_sem_projeto'
  | 'inactive_12_24h';

export interface DashboardAttentionItem {
  id: number;
  customerName: string | null;
  contactPhone: string | null;
  reason: string;
  enterpriseName: string | null;
}

export interface DashboardAttentionItemsResponse {
  attentionItems: DashboardAttentionItem[];
  attentionType: DashboardAttentionType;
}

export interface DashboardOverview {
  period: DashboardPeriod;
  periodStart: string;
  enterpriseId: number | null;
  kpis: {
    newConversationsToday: number;
    activeConversations: number;
    qualified: number;
    handoffs: number;
    carteira: number;
    avgFirstResponseSeconds: number | null;
    noFirstResponse: number;
  };
  timeline: { date: string; newConversations: number }[];
  classification: { label: string; count: number }[];
  enterprises: {
    enterpriseId: number | null;
    name: string;
    total: number;
    qualified: number;
    handoffs: number;
    carteiras: number;
    llmCostUsd: number | null;
    llmTrackedCostUsd: number | null;
    llmEstimatedCostUsd: number | null;
    llmCalls: number;
    llmInputTokens: number;
    llmOutputTokens: number;
    llmTotalTokens: number;
    llmCostPerContact: number | null;
    llmCostPerConversation: number | null;
  }[];
}

export const dashboardApi = {
  overview: (params: { period?: DashboardPeriod; enterpriseId?: number | null }) => {
    const q = new URLSearchParams();
    if (params.period) q.set('period', params.period);
    if (params.enterpriseId != null && params.enterpriseId !== undefined) {
      q.set('enterpriseId', String(params.enterpriseId));
    }
    const qs = q.toString();
    return request<DashboardOverview>(`/dashboard/overview${qs ? `?${qs}` : ''}`);
  },
  attentionItems: (params: { enterpriseId?: number | null; attentionType?: DashboardAttentionType }) => {
    const q = new URLSearchParams();
    if (params.enterpriseId != null && params.enterpriseId !== undefined) {
      q.set('enterpriseId', String(params.enterpriseId));
    }
    if (params.attentionType && params.attentionType !== 'all') {
      q.set('attentionType', params.attentionType);
    }
    const qs = q.toString();
    return request<DashboardAttentionItemsResponse>(`/dashboard/attention-items${qs ? `?${qs}` : ''}`);
  },
  downloadCsv: async (params: { period?: DashboardPeriod; enterpriseId?: number | null }) => {
    const q = new URLSearchParams();
    if (params.period) q.set('period', params.period);
    if (params.enterpriseId != null && params.enterpriseId !== undefined) {
      q.set('enterpriseId', String(params.enterpriseId));
    }
    const qs = q.toString();
    const token = getStoredAuthToken();
    const res = await fetch(`${API_BASE}/dashboard/export.csv${qs ? `?${qs}` : ''}`, {
      method: 'GET',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (res.status === 401) {
      handleUnauthorized();
      throw new Error('Sessão expirada. Faça login novamente.');
    }
    if (!res.ok) {
      let msg = `Erro ${res.status}`;
      try {
        const data = await res.json();
        msg = (data as { error?: string }).error ?? msg;
      } catch {
        // noop
      }
      throw new Error(msg);
    }
    const blob = await res.blob();
    const disposition = res.headers.get('content-disposition') ?? '';
    const filenameMatch = disposition.match(/filename="([^"]+)"/i);
    const filename = filenameMatch?.[1] ?? 'dashboard.csv';
    return { blob, filename };
  },
  downloadDjangoCsv: async (params: { period?: DashboardPeriod; enterpriseId?: number | null }) => {
    const q = new URLSearchParams();
    if (params.period) q.set('period', params.period);
    if (params.enterpriseId != null && params.enterpriseId !== undefined) {
      q.set('enterpriseId', String(params.enterpriseId));
    }
    const qs = q.toString();
    const token = getStoredAuthToken();
    const res = await fetch(`${API_BASE}/dashboard/export-django.csv${qs ? `?${qs}` : ''}`, {
      method: 'GET',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (res.status === 401) {
      handleUnauthorized();
      throw new Error('Sessão expirada. Faça login novamente.');
    }
    if (!res.ok) {
      let msg = `Erro ${res.status}`;
      try {
        const data = await res.json();
        msg = (data as { error?: string }).error ?? msg;
      } catch {
        // noop
      }
      throw new Error(msg);
    }
    const blob = await res.blob();
    const disposition = res.headers.get('content-disposition') ?? '';
    const filenameMatch = disposition.match(/filename="([^"]+)"/i);
    const filename = filenameMatch?.[1] ?? 'leads-django.csv';
    return { blob, filename };
  },
};

export interface UserListItem {
  id: number;
  name: string;
  email: string;
  role: UserRole;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export const usersApi = {
  list: () => request<{ users: UserListItem[] }>('/users'),
  create: (body: { name: string; email: string; password: string; role: UserRole; active: boolean }) =>
    request<{ user: UserListItem }>('/users', { method: 'POST', body }),
  update: (id: number, body: { name?: string; email?: string; role?: UserRole; active?: boolean }) =>
    request<{ user: UserListItem }>(`/users/${id}`, { method: 'PATCH', body }),
  updatePassword: (id: number, newPassword: string) =>
    request<{ ok: boolean }>(`/users/${id}/password`, { method: 'PATCH', body: { newPassword } }),
};

// API de disparo em lote (templates WhatsApp; rotas /whatsapp-batch no servidor)
export const whatsappBatchApi = {
  listTemplates: (opts?: { refresh?: boolean }) =>
    request<{ templates: BatchTemplateCatalogItem[]; warning?: string | null; source?: string }>(
      `/whatsapp-batch/templates?ts=${Date.now()}${opts?.refresh ? '&refresh=1' : ''}`
    ),
  parseSpreadsheet: (file: File, opts?: { templateKey?: string }) => {
    const formData = new FormData();
    formData.append('file', file);
    if (opts?.templateKey) formData.append('templateKey', opts.templateKey);
    return requestFormData<BatchParseResponse>('/whatsapp-batch/parse', formData);
  },
  buildPreview: (spreadsheet: BatchParseResponse['spreadsheet'], mapping: any) =>
    request<BatchPreviewResponse>('/whatsapp-batch/preview', {
      method: 'POST',
      body: { spreadsheet, mapping },
    }),
  sendTest: (params: {
    spreadsheet: BatchParseResponse['spreadsheet'];
    mapping: any;
    testPhone: string;
    mode: 'row' | 'manual';
    sampleRowIndex?: number;
    manualVariables?: Record<string, string>;
  }) =>
    request<BatchTestResult>('/whatsapp-batch/test', {
      method: 'POST',
      body: params,
    }),
  sendBatch: (spreadsheet: BatchParseResponse['spreadsheet'], mapping: any) =>
    request<BatchSendResult>('/whatsapp-batch/send', {
      method: 'POST',
      body: { spreadsheet, mapping },
    }),
};

// Knowledge API
export const knowledgeApi = {
  listJobs: () => request<{ success: boolean; jobs: any[] }>('/knowledge/reindex/jobs'),
  getJob: (jobId: string) => request<{ success: boolean; job: any }>(`/knowledge/reindex/jobs/${jobId}`),
  deleteJob: (jobId: string) => request<{ success: boolean; message: string }>(`/knowledge/reindex/jobs/${jobId}`, { method: 'DELETE' }),
  startReindex: (params: { dryRun?: boolean; enterpriseId?: number; fileId?: number; maxFiles?: number }) =>
    request<{ success: boolean; jobId: string; message: string }>('/knowledge/reindex/start', {
      method: 'POST',
      body: params,
    }),
  listFiles: (params?: { enterpriseId?: number; includeInactive?: boolean }) => {
    const q = new URLSearchParams();
    if (params?.enterpriseId) q.set('enterpriseId', String(params.enterpriseId));
    if (params?.includeInactive) q.set('includeInactive', 'true');
    const qs = q.toString();
    return request<{ success: boolean; files: any[] }>(`/knowledge/files${qs ? `?${qs}` : ''}`);
  },
};

// Reengagement API
export const reengagementApi = {
  getStatus: () => request<{ active: boolean; service: string; timestamp: string }>('/reengagement/status'),
  triggerScan: () => request<{ success: boolean; message: string; timestamp: string }>('/reengagement/scan', { method: 'POST' }),
};
