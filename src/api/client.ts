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
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Erro ${res.status}`);
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
  getConversations: (params?: {
    channel?: string;
    limit?: number;
    mode?: 'all' | 'ANA' | 'handoff';
    status?: string;
    enterpriseId?: number;
    search?: string;
  }) => {
    const q = new URLSearchParams();
    if (params?.channel) q.set('channel', params.channel);
    if (params?.limit != null) q.set('limit', String(params.limit));
    if (params?.mode && params.mode !== 'all') q.set('mode', params.mode);
    if (params?.status && params.status !== 'all') q.set('status', params.status);
    if (params?.enterpriseId != null) q.set('enterpriseId', String(params.enterpriseId));
    if (params?.search?.trim()) q.set('search', params.search.trim());
    const query = q.toString();
    return request<{ conversations: ConversationListItem[] }>(`/whatsapp/conversations${query ? `?${query}` : ''}`);
  },
  getConversationMessages: (conversationId: number) =>
    request<{ conversationId: number; messages: MessageListItem[] }>(`/whatsapp/conversations/${conversationId}/messages`),
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
  sendToConversation: (conversationId: number, message: string) =>
    request<{ success: boolean; metaMessageId?: string }>(`/whatsapp/conversations/${conversationId}/send`, {
      method: 'POST',
      body: { message },
    }),
  deleteConversation: (conversationId: number) =>
    request<{ success: boolean }>(`/whatsapp/conversations/${conversationId}`, { method: 'DELETE' }),
  deleteAllByPhone: (phone: string) =>
    request<{ success: boolean; deletedCount: number }>(
      `/whatsapp/conversations/by-phone/${encodeURIComponent(phone)}`,
      { method: 'DELETE' }
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
    fd.append('canBeUsedAsKnowledge', opts?.canBeUsedAsKnowledge !== false ? 'true' : 'false');
    fd.append('canBeSentByAna', opts?.canBeSentByAna === true ? 'true' : 'false');
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
    request<{ ok: boolean; removed?: boolean; deactivated?: boolean; message?: string }>(
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
  }[];
  attentionItems: {
    id: number;
    customerName: string | null;
    contactPhone: string | null;
    reason: string;
    enterpriseName: string | null;
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
