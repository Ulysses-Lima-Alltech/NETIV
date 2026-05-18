import { useState, useEffect, useCallback, useRef, useMemo, useLayoutEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { Conversation, LeadTemperatura, Message } from '../types';
import {
  whatsappApi,
  projectsApi,
  ApiError,
  type ReserveSegmentationPatchBody,
  type WhatsAppWindowStatus,
} from '../api/client';
import type { ConversationListItem as ApiConversation, MessageListItem } from '../api/client';
import { ConversationList } from '../components/ConversationList';
import { ChatPanel } from '../components/ChatPanel';
import { NewMessageModal } from '../components/NewMessageModal';
import { InboxFilterBar } from '../components/InboxFilterBar';
import {
  DEFAULT_INBOX_FILTERS,
  hasActiveInboxFilters,
  inboxFiltersToApiParams,
  type InboxFilters,
} from '../components/inboxFilters';
import { useRealtimeInbox } from '../hooks/useRealtimeInbox';

const INBOX_READ_STATE_KEY = 'inbox_read_state_v1';
const INBOX_CONVERSATION_PANEL_COLLAPSED_KEY = 'inbox_conversation_panel_collapsed_v1';
type InboxReadStateMap = Record<string, string>;
function toMillis(value: string | null | undefined): number | null {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}

function maxIso(a: string | null | undefined, b: string | null | undefined): string | null {
  const ta = toMillis(a);
  const tb = toMillis(b);
  if (ta == null && tb == null) return null;
  if (ta == null) return b ?? null;
  if (tb == null) return a ?? null;
  return ta >= tb ? (a ?? null) : (b ?? null);
}

function loadInboxReadState(): InboxReadStateMap {
  try {
    const raw = localStorage.getItem(INBOX_READ_STATE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as InboxReadStateMap;
    }
  } catch {
    // noop
  }
  return {};
}

function saveInboxReadState(state: InboxReadStateMap): void {
  try {
    localStorage.setItem(INBOX_READ_STATE_KEY, JSON.stringify(state));
  } catch {
    // noop
  }
}

function computeUnreadCountFromReadState(conversation: Conversation, readState: InboxReadStateMap): number {
  const lastReadAtRaw = readState[conversation.id] ?? null;
  if (!lastReadAtRaw) return 1;
  const updatedMs = new Date(conversation.updatedAt).getTime();
  const readMs = new Date(lastReadAtRaw).getTime();
  if (!Number.isFinite(updatedMs) || !Number.isFinite(readMs)) return 0;
  return updatedMs > readMs ? 1 : 0;
}

function readConversationPanelCollapsedPreference(): boolean {
  try {
    return localStorage.getItem(INBOX_CONVERSATION_PANEL_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

function mapApiConversationToConversation(c: ApiConversation): Conversation {
  const leadName =
    (c.whatsappDisplayName ?? '').trim() ||
    (c.customerName ?? '').trim() ||
    (c.contactName ?? '').trim() ||
    c.contactPhone ||
    c.externalContactId ||
    'Sem nome';
  const leadPhone = c.contactPhone || c.externalContactId || '';
  const ls = c.leadStage;
  const temperatura: LeadTemperatura | null =
    ls == null || ls === ''
      ? null
      : ls.toUpperCase() === 'HOT'
        ? 'quente'
        : ls.toUpperCase() === 'WARM'
          ? 'morno'
          : 'frio';
  const projectName = c.projectName ?? null;
  const empreendimento = projectName;
  const raw = c.classificationStatus || 'Novo';
  const normalized = raw === 'Reserva' ? 'Carteira' : raw;
  const status = (normalized === 'Interessado' || normalized === 'Qualificando'
    ? 'Qualificado'
    : ['Handoff', 'Qualificado', 'Carteira', 'Novo'].includes(normalized)
      ? normalized
      : 'Novo') as Conversation['status'];
  return {
    id: c.id,
    leadName,
    confirmedCustomerName: c.customerName ?? null,
    leadPhone,
    lastMessage: c.lastMessagePreview || '',
    updatedAt: c.lastMessageAt || c.updatedAt || c.createdAt,
    unreadCount: 0,
    status,
    empreendimento,
    temperatura,
    projectId: c.projectId ?? null,
    projectName: projectName ?? null,
    classificationStatus: status,
    handoff: c.handoff ?? (status === 'Handoff'),
    enterpriseOriginId: c.enterpriseOriginId ?? null,
    enterpriseOriginName: undefined,
    assignedBrokerName: c.assignedBrokerName ?? null,
    assignedBrokerId: c.assignedBrokerId ?? null,
    reserveReason: c.reserveReason ?? null,
    reserveDesiredCity: c.reserveDesiredCity ?? null,
    reservePriceMin: c.reservePriceMin ?? null,
    reservePriceMax: c.reservePriceMax ?? null,
    reservePropertyType: c.reservePropertyType ?? null,
    reserveBedrooms: c.reserveBedrooms ?? null,
    reserveInterestType: c.reserveInterestType ?? null,
    reserveFollowUpMoment: c.reserveFollowUpMoment ?? null,
    reserveCommercialNotes: c.reserveCommercialNotes ?? null,
    manualClosedAt: c.manualClosedAt ?? null,
    manualClosedByUserId: c.manualClosedByUserId ?? null,
    manualClosedReason: c.manualClosedReason ?? null,
    reengagementCount: c.reengagementCount ?? 0,
  };
}

function mapApiMessageToMessage(m: MessageListItem, conversationId: string): Message {
  const att = m.attachment;
  return {
    id: String(m.id),
    conversationId,
    sender: m.direction === 'inbound' ? 'LEAD' : 'AGENT',
    text: m.deleted ? '' : (m.content || ''),
    createdAt: m.createdAt,
    messageType: m.type === 'document' || m.type === 'image' ? m.type : 'text',
    attachment: m.deleted
      ? null
      : att?.fileName
        ? {
            fileName: att.fileName,
            mimeType: att.mimeType ?? 'application/octet-stream',
            sizeBytes: att.sizeBytes,
            whatsappMediaId: att.whatsappMediaId ?? null,
            caption: att.caption ?? null,
            enterpriseFileId: att.enterpriseFileId ?? null,
          }
        : null,
    deleted: m.deleted ?? false,
    deletedAt: m.deletedAt ?? null,
  };
}

function upsertMessageList(prev: Message[], incoming: Message): Message[] {
  const tempIdx = prev.findIndex(
    (m) =>
      (String(m.id).startsWith('temp-') || String(m.id).startsWith('sent-')) &&
      m.sender === incoming.sender &&
      (m.text || '') === (incoming.text || '')
  );
  if (tempIdx >= 0) {
    const next = [...prev];
    next[tempIdx] = { ...incoming };
    return next.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }
  const idx = prev.findIndex(
    (m) =>
      m.id === incoming.id ||
      (m.createdAt === incoming.createdAt &&
        m.sender === incoming.sender &&
        (m.text || '') === (incoming.text || ''))
  );
  if (idx >= 0) {
    const next = [...prev];
    next[idx] = { ...next[idx], ...incoming };
    return next;
  }
  return [...prev, incoming].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

export function InboxPage() {
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<'CLIENT' | 'INTERNO'>('CLIENT');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationsLoading, setConversationsLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [conversationPanelCollapsed, setConversationPanelCollapsed] = useState<boolean>(() =>
    readConversationPanelCollapsedPreference()
  );
  const [newMessageOpen, setNewMessageOpen] = useState(false);
  const [projects, setProjects] = useState<{ id: number; name: string; active: boolean }[]>([]);
  const [filters, setFilters] = useState<InboxFilters>(DEFAULT_INBOX_FILTERS);
  const [searchDebounced, setSearchDebounced] = useState(filters.search);
  const [readStateMap, setReadStateMap] = useState<InboxReadStateMap>(() => loadInboxReadState());
  const readStateMapRef = useRef<InboxReadStateMap>(readStateMap);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  /** Evita reprocessar o mesmo `conversationId` da URL (sucesso ou falha) em loop. */
  const deepLinkConsumedParamRef = useRef<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const conversationsRequestIdRef = useRef(0);
  const messagesRequestIdRef = useRef(0);
  const lastLoadedConversationIdRef = useRef<string | null>(null);
  const pendingScrollModeRef = useRef<'none' | 'force' | 'if-near'>('none');
  const [showNewMessageIndicator, setShowNewMessageIndicator] = useState(false);
  const inflightRealtimeConversationFetchRef = useRef<Set<string>>(new Set());
  const conversationListScrollTopRef = useRef(0);
  const isConversationListNearTopRef = useRef(true);
  const pendingRealtimeConversationsRef = useRef<Map<string, Conversation>>(new Map());
  const [hasPendingRealtimeUpdates, setHasPendingRealtimeUpdates] = useState(false);

  const rawConversationParam = searchParams.get('conversationId')?.trim() ?? '';
  const parsedConversationId = useMemo(() => {
    if (!rawConversationParam) return null;
    const n = parseInt(rawConversationParam, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [rawConversationParam]);

  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(filters.search), 400);
    return () => clearTimeout(t);
  }, [filters.search]);

  const isUserAtBottom = useCallback(() => {
    const el = chatScrollRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 50;
  }, []);

  const scrollToBottom = useCallback(() => {
    const el = chatScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  const scheduleScrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        scrollToBottom();
      });
    });
  }, [scrollToBottom]);

  const mergeConversation = useCallback((incoming: Conversation) => {
    setConversations((prev) => {
      const idx = prev.findIndex((c) => c.id === incoming.id);
      const nextRow = idx >= 0 ? { ...prev[idx]!, ...incoming } : incoming;
      const next = idx >= 0
        ? prev.map((c) => (c.id === incoming.id ? nextRow : c))
        : [...prev, nextRow];
      setHasPendingRealtimeUpdates(false);
      pendingRealtimeConversationsRef.current.delete(incoming.id);
      return next.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    });
  }, []);

  const applyPendingRealtimeUpdates = useCallback(() => {
    setConversations((prev) => {
      const pending = Array.from(pendingRealtimeConversationsRef.current.values());
      pendingRealtimeConversationsRef.current.clear();
      setHasPendingRealtimeUpdates(false);
      return [...prev, ...pending]
        .reduce<Conversation[]>((acc, row) => {
          if (acc.some((c) => c.id === row.id)) return acc;
          acc.push(row);
          return acc;
        }, [])
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    });
  }, []);

  const fetchAndMergeConversationById = useCallback((conversationId: string) => {
    if (inflightRealtimeConversationFetchRef.current.has(conversationId)) return;
    const numId = parseInt(conversationId, 10);
    if (!Number.isFinite(numId) || numId <= 0) return;
    inflightRealtimeConversationFetchRef.current.add(conversationId);
    void whatsappApi
      .getConversation(numId)
      .then((item) => {
        const mapped = mapApiConversationToConversation(item);
        setConversations((prev) => {
          const idx = prev.findIndex((c) => c.id === mapped.id);
          const next = idx >= 0
            ? prev.map((c) => (c.id === mapped.id ? { ...c, ...mapped } : c))
            : [...prev, mapped];
          setHasPendingRealtimeUpdates(false);
          pendingRealtimeConversationsRef.current.delete(mapped.id);
          return next.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
        });
      })
      .catch(() => {
        // noop: conversa pode estar fora de escopo/filtro no momento.
      })
      .finally(() => {
        inflightRealtimeConversationFetchRef.current.delete(conversationId);
      });
  }, []);

  const selectedConversation = selectedId
    ? conversations.find((c) => c.id === selectedId) ?? null
    : null;
  const selectedWindow = selectedConversation?.whatsappWindow ?? null;

  useEffect(() => {
    try {
      localStorage.setItem(INBOX_CONVERSATION_PANEL_COLLAPSED_KEY, conversationPanelCollapsed ? '1' : '0');
    } catch {
      // noop
    }
  }, [conversationPanelCollapsed]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    readStateMapRef.current = readStateMap;
  }, [readStateMap]);

  const markConversationAsRead = useCallback((convId: string, readAtHint?: string | null) => {
    setConversations((prev) => prev.map((c) => (c.id === convId ? { ...c, unreadCount: 0 } : c)));
    setReadStateMap((prev) => {
      const nextReadAt = maxIso(prev[convId] ?? null, readAtHint ?? null) ?? new Date().toISOString();
      const next = { ...prev, [convId]: nextReadAt };
      saveInboxReadState(next);
      return next;
    });
  }, []);

  const applyReadFilter = useCallback((list: Conversation[]) => {
    if (filters.readState === 'read') return list.filter((c) => c.unreadCount === 0);
    if (filters.readState === 'unread') return list.filter((c) => c.unreadCount > 0);
    return list;
  }, [filters.readState]);

  const loadConversations = useCallback((silent?: boolean) => {
    if (!silent) setConversationsLoading(true);
    const requestId = ++conversationsRequestIdRef.current;
    const params = inboxFiltersToApiParams({ ...filters, search: searchDebounced });
    return whatsappApi
      .getConversations({ ...params, limit: 200, type: activeTab })
      .then((data) => {
        if (requestId !== conversationsRequestIdRef.current) return;
        const mappedRaw = data.conversations.map(mapApiConversationToConversation);
        const mappedWithUnread = mappedRaw.map((c) => ({
          ...c,
          unreadCount: c.id === selectedIdRef.current ? 0 : computeUnreadCountFromReadState(c, readStateMapRef.current),
        }));
        const mapped = applyReadFilter(mappedWithUnread);
        setConversations((prev) => {
          const sid = selectedIdRef.current;
          if (!sid) return mapped;
          if (mapped.some((c) => c.id === sid)) return mapped;
          const orphan = prev.find((c) => c.id === sid);
          if (orphan) {
            return [{ ...orphan, unreadCount: 0 }, ...mapped];
          }
          return mapped;
        });
      })
      .catch(() => {
        if (requestId !== conversationsRequestIdRef.current) return;
        // Mantém lista atual para não perder seleção/conversa ativa em falha transitória.
      })
      .finally(() => {
        if (requestId !== conversationsRequestIdRef.current) return;
        if (!silent) setConversationsLoading(false);
      });
  }, [activeTab, filters, searchDebounced, applyReadFilter]);

  const loadMessages = useCallback((convId: string, silent?: boolean) => {
    const id = parseInt(convId, 10);
    if (Number.isNaN(id)) return Promise.resolve();
    const shouldScroll = isUserAtBottom();
    const conversationChanged = lastLoadedConversationIdRef.current !== convId;
    const requestId = ++messagesRequestIdRef.current;
    if (!silent) setMessagesLoading(true);
    if (!silent) setMessagesError(null);
    if (!silent) setSendError(null);
    return whatsappApi
      .getConversationMessages(id)
      .then((data) => {
        if (requestId !== messagesRequestIdRef.current) return;
        if (selectedIdRef.current !== convId) return;
        const windowStatus: WhatsAppWindowStatus | undefined = data.window;
        setConversations((prev) =>
          prev.map((c) => (c.id === convId ? { ...c, whatsappWindow: windowStatus ?? c.whatsappWindow } : c))
        );
        const apiMapped = data.messages
          .map((m) => mapApiMessageToMessage(m, convId))
          .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        let isNewConversation = false;
        setMessages((prev) => {
          if (selectedIdRef.current !== convId) return prev;
          const currentConvMessages = prev.filter((m) => m.conversationId === convId);
          if (currentConvMessages.length === 0) {
            isNewConversation = true;
            return apiMapped;
          }
          const apiHasSameText = (text: string) => apiMapped.some((a) => a.text === text);
          const prevRealAndTemp = currentConvMessages.filter(
            (m) =>
              (!String(m.id).startsWith('temp-') && !String(m.id).startsWith('sent-')) ||
              !apiHasSameText(m.text)
          );
          const existingIds = new Set(prevRealAndTemp.map((m) => m.id));
          const newMessages = apiMapped.filter((m) => !existingIds.has(m.id));
          if (newMessages.length === 0) return prev;
          return [...prevRealAndTemp, ...newMessages].sort(
            (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
          );
        });
        if (isNewConversation || conversationChanged) pendingScrollModeRef.current = 'force';
        else if (shouldScroll) pendingScrollModeRef.current = 'if-near';
        lastLoadedConversationIdRef.current = convId;
        const latestMessageAt = apiMapped.length > 0 ? apiMapped[apiMapped.length - 1]?.createdAt : null;
        markConversationAsRead(convId, latestMessageAt);
      })
      .catch(() => {
        if (requestId !== messagesRequestIdRef.current) return;
        if (!silent) setMessagesError('Falha ao carregar');
      })
      .finally(() => {
        if (requestId !== messagesRequestIdRef.current) return;
        if (!silent) setMessagesLoading(false);
      });
  }, [isUserAtBottom, markConversationAsRead]);

  useLayoutEffect(() => {
    if (!selectedId) return;
    if (pendingScrollModeRef.current === 'none') return;
    const mode = pendingScrollModeRef.current;
    pendingScrollModeRef.current = 'none';
    if (mode === 'force') {
      scheduleScrollToBottom();
      return;
    }
    if (mode === 'if-near') {
      scheduleScrollToBottom();
    }
  }, [messages, messagesLoading, selectedId, scheduleScrollToBottom]);

  useEffect(() => {
    const el = chatScrollRef.current;
    if (!el) return;
    const onScroll = () => {
      if (el.scrollHeight - el.scrollTop - el.clientHeight < 50) {
        setShowNewMessageIndicator(false);
      }
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [selectedId]);

  useEffect(() => { loadConversations(); }, [loadConversations]);

  useRealtimeInbox({
    onConversationCreated: (payload) => {
      if (!payload || typeof payload !== 'object') return;
      mergeConversation(mapApiConversationToConversation(payload as ApiConversation));
    },
    onConversationUpdated: (payload) => {
      if (!payload || typeof payload !== 'object') return;
      mergeConversation(mapApiConversationToConversation(payload as ApiConversation));
    },
    onMessageCreated: (payload) => {
      if (!payload || typeof payload !== 'object') return;
      const p = payload as {
        id: string;
        conversationId: number;
        role: 'user' | 'assistant';
        content: string | null;
        messageKind?: 'text' | 'document' | 'image';
        attachment?: unknown;
        createdAt: string;
        deleted?: boolean;
        deletedAt?: string | null;
      };
      const sid = selectedIdRef.current;
      const convId = String(p.conversationId);
      const selectedConversationId = sid == null ? null : String(sid);
      const equalAfterStringCast =
        selectedConversationId != null &&
        String(convId) === String(selectedConversationId);
      const direction = p.role === 'user' ? 'inbound' : 'outbound';
      console.info('[RealtimeInbox] message.created received', {
        conversationId: convId,
        messageId: String(p.id),
        direction,
        selectedConversationId,
      });
      console.info('[RealtimeInbox] selected conversation compare', {
        eventConversationId: convId,
        selectedConversationId,
        equalAfterStringCast,
      });
      const incoming: Message = {
        id: String(p.id),
        conversationId: convId,
        sender: p.role === 'user' ? 'LEAD' : 'AGENT',
        text: p.deleted ? '' : (p.content ?? ''),
        createdAt: p.createdAt,
        messageType: p.messageKind === 'document' || p.messageKind === 'image' ? p.messageKind : 'text',
        attachment:
          p.deleted || !p.attachment || typeof p.attachment !== 'object'
            ? null
            : ({
                fileName: (p.attachment as { fileName?: string }).fileName ?? '',
                mimeType: (p.attachment as { mimeType?: string }).mimeType ?? 'application/octet-stream',
                sizeBytes: (p.attachment as { sizeBytes?: number }).sizeBytes,
                whatsappMediaId: (p.attachment as { whatsappMediaId?: string | null }).whatsappMediaId ?? null,
                caption: (p.attachment as { caption?: string | null }).caption ?? null,
                enterpriseFileId: (p.attachment as { enterpriseFileId?: number | null }).enterpriseFileId ?? null,
              }),
        deleted: p.deleted ?? false,
        deletedAt: p.deletedAt ?? null,
      };

      const atBottom = isUserAtBottom();
      if (equalAfterStringCast) {
        setMessages((prev) => upsertMessageList(prev, incoming));
        console.info('[RealtimeInbox] message.created applied_to_open_chat', {
          conversationId: convId,
          messageId: incoming.id,
        });
        markConversationAsRead(convId, incoming.createdAt);
        if (atBottom) {
          pendingScrollModeRef.current = 'if-near';
          setShowNewMessageIndicator(false);
        } else {
          setShowNewMessageIndicator(true);
        }
      } else {
        console.info('[RealtimeInbox] message.created ignored_reason', {
          reason: selectedConversationId == null ? 'no_selected_conversation' : 'not_selected_conversation',
          conversationId: convId,
          selectedConversationId,
        });
      }

      let conversationKnown = true;
      setConversations((prev) => {
        const idx = prev.findIndex((c) => c.id === convId);
        if (idx < 0) {
          conversationKnown = false;
          return prev;
        }
        const row = prev[idx]!;
        const nextUnread = equalAfterStringCast ? 0 : Math.max(1, row.unreadCount || 0);
        const updatedRow: Conversation = {
          ...row,
          lastMessage: incoming.text || row.lastMessage,
          updatedAt: incoming.createdAt,
          unreadCount: nextUnread,
        };
        const next = [...prev];
        next[idx] = updatedRow;
        setHasPendingRealtimeUpdates(false);
        return next.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      });
      if (!conversationKnown) {
        fetchAndMergeConversationById(convId);
      }
    },
    onMessageUpdated: (payload) => {
      if (!payload || typeof payload !== 'object') return;
      const parsed = payload as { id: string; conversationId: number; deleted?: boolean; deletedAt?: string | null };
      const convId = String(parsed.conversationId);
      if (String(selectedIdRef.current) !== String(convId)) return;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === String(parsed.id)
            ? { ...m, deleted: parsed.deleted ?? true, deletedAt: parsed.deletedAt ?? null, text: '', attachment: null }
            : m
        )
      );
    },
  });

  const handleTabChange = useCallback((tab: 'CLIENT' | 'INTERNO') => {
    if (tab === activeTab) return;
    conversationsRequestIdRef.current += 1;
    setConversations([]);
    setSelectedId(null);
    setMessages([]);
    setMessagesError(null);
    setActiveTab(tab);
  }, [activeTab]);

  useEffect(() => {
    if (!rawConversationParam) {
      deepLinkConsumedParamRef.current = null;
      return;
    }
    if (parsedConversationId == null) {
      deepLinkConsumedParamRef.current = rawConversationParam;
      return;
    }
    if (deepLinkConsumedParamRef.current === rawConversationParam) return;

    let cancelled = false;
    void (async () => {
      try {
        const item = await whatsappApi.getConversation(parsedConversationId);
        if (cancelled) return;
        const mapped = mapApiConversationToConversation(item);
        setConversations((prev) => {
          if (prev.some((c) => c.id === mapped.id)) return prev;
          return [mapped, ...prev];
        });
        setSelectedId(mapped.id);
        deepLinkConsumedParamRef.current = rawConversationParam;
      } catch {
        if (cancelled) return;
        deepLinkConsumedParamRef.current = rawConversationParam;
      }
    })();
    return () => { cancelled = true; };
  }, [rawConversationParam, parsedConversationId]);

  const clearFilters = useCallback(() => setFilters(DEFAULT_INBOX_FILTERS), []);

  useEffect(() => {
    projectsApi
      .list(true)
      .then((data) =>
        setProjects(data.projects.map((p) => ({ id: p.id, name: p.name, active: p.status === 'ativo' })))
      )
      .catch(() => setProjects([]));
  }, []);

  useEffect(() => {
    if (!selectedId) { setMessages([]); setMessagesError(null); return; }
    setShowNewMessageIndicator(false);
    pendingScrollModeRef.current = 'force';
    setMessages([]);
    markConversationAsRead(selectedId);
    loadMessages(selectedId);
  }, [selectedId, loadMessages, markConversationAsRead]);

  const handleSendMessage = useCallback(
    async (text: string, file?: File | null) => {
      if (!selectedId) return;
      if (selectedWindow && !selectedWindow.isOpen) {
        setSendError(
          'Este contato não interagiu nas últimas 24 horas. Para iniciar contato, use uma mensagem padrão/template.'
        );
        return;
      }
      const id = parseInt(selectedId, 10);
      if (Number.isNaN(id)) return;
      if (!text.trim() && !file) return;
      setSendError(null);
      setSending(true);
      const preview =
        file != null
          ? text.trim()
            ? `${text.trim()}\n\n📎 ${file.name}`
            : `📎 ${file.name}`
          : text;
      const tempMessage: Message = {
        id: `temp-${Date.now()}`,
        conversationId: selectedId,
        sender: 'AGENT',
        text: preview,
        createdAt: new Date().toISOString(),
        messageType: file ? 'document' : 'text',
        attachment: file ? { fileName: file.name, mimeType: file.type || 'application/octet-stream' } : null,
      };
      const shouldScroll = isUserAtBottom();
      setMessages((prev) => [...prev, tempMessage]);
      if (shouldScroll) {
        pendingScrollModeRef.current = 'if-near';
        scheduleScrollToBottom();
      }
      try {
        await whatsappApi.sendToConversation(id, text, file ?? null);
        setMessages((prev) => prev.map((m) => (m.id === tempMessage.id ? { ...tempMessage, id: `sent-${Date.now()}` } : m)));
      } catch (e) {
        setMessages((prev) => prev.filter((m) => m.id !== tempMessage.id));
        if (e instanceof ApiError && e.code === 'WHATSAPP_WINDOW_CLOSED') {
          setSendError(
            'Este contato não interagiu nas últimas 24 horas. Para iniciar contato, use uma mensagem padrão/template.'
          );
        } else {
          setSendError(e instanceof Error ? e.message : 'Erro ao enviar mensagem.');
        }
      } finally {
        setSending(false);
      }
    },
    [selectedId, selectedWindow, isUserAtBottom, scheduleScrollToBottom]
  );

  const handleNewMessageSent = useCallback(
    (conversationId: number | undefined) => {
      setNewMessageOpen(false);
      if (conversationId != null) setSelectedId(String(conversationId));
    },
    []
  );

  const handleCloseConversation = useCallback(async () => {
    if (!selectedId) return;
    const numId = parseInt(selectedId, 10);
    if (Number.isNaN(numId)) return;
    try {
      await whatsappApi.closeConversation(numId);
      setConversations((prev) =>
        prev.map((c) => (c.id === selectedId ? { ...c, manualClosedAt: new Date().toISOString() } : c))
      );
    } catch (e) {
      console.error('[InboxPage] closeConversation:', e);
    }
  }, [selectedId]);

  const handleReopenConversation = useCallback(async () => {
    if (!selectedId) return;
    const numId = parseInt(selectedId, 10);
    if (Number.isNaN(numId)) return;
    try {
      await whatsappApi.reopenConversation(numId);
      setConversations((prev) =>
        prev.map((c) => (c.id === selectedId ? { ...c, manualClosedAt: null } : c))
      );
    } catch (e) {
      console.error('[InboxPage] reopenConversation:', e);
    }
  }, [selectedId]);

  const handleDeleteConversation = useCallback(
    async (id: string) => {
      if (!confirm('Deseja excluir esta conversa?')) return;
      const numId = parseInt(id, 10);
      if (Number.isNaN(numId)) return;
      try {
        await whatsappApi.deleteConversation(numId);
        setConversations((prev) => prev.filter((c) => c.id !== id));
        if (selectedId === id) {
          setSelectedId(null);
          setMessages([]);
          setMessagesError(null);
        }
      } catch (e) {
        console.error('[InboxPage] deleteConversation:', e);
      }
    },
    [selectedId]
  );

  const handleResetConversation = useCallback(
    async (conversationIdStr: string) => {
      if (
        !confirm(
          'Resetar esta conversa? As mensagens permanecem no histórico; só os dados comerciais e operacionais serão limpos.'
        )
      )
        return;
      const numId = parseInt(conversationIdStr, 10);
      if (Number.isNaN(numId)) return;
      try {
        await whatsappApi.resetConversation(numId);
        setConversations((prev) =>
          prev.map((c) =>
            c.id === conversationIdStr
              ? {
                  ...c,
                  status: 'Novo',
                  classificationStatus: 'Novo',
                  handoff: false,
                  temperatura: 'frio',
                  projectId: null,
                  projectName: null,
                  empreendimento: null,
                  assignedBrokerId: null,
                  assignedBrokerName: null,
                  reserveReason: null,
                  reserveDesiredCity: null,
                  reservePriceMin: null,
                  reservePriceMax: null,
                  reservePropertyType: null,
                  reserveBedrooms: null,
                  reserveInterestType: null,
                  reserveFollowUpMoment: null,
                  reserveCommercialNotes: null,
                }
              : c
          )
        );
      } catch (e) {
        console.error('[InboxPage] resetConversation:', e);
      }
    },
    []
  );

  const handleUpdateCustomerName = useCallback(
    async (name: string | null) => {
      if (!selectedId) return;
      const convId = parseInt(selectedId, 10);
      if (Number.isNaN(convId)) return;
      await whatsappApi.updateCustomerName(convId, name);
      const trimmed = name?.trim() || null;
      setConversations((prev) =>
        prev.map((c) => {
          if (c.id !== selectedId) return c;
          // Atualiza confirmedCustomerName e recalcula leadName
          // (leadName mostra WA display name se houver; caso contrário, o nome editado)
          const oldConfirmed = (c.confirmedCustomerName ?? '').trim();
          const leadNameWasConfirmed =
            !oldConfirmed || c.leadName === oldConfirmed;
          return {
            ...c,
            confirmedCustomerName: trimmed,
            leadName: leadNameWasConfirmed
              ? (trimmed || c.leadPhone || 'Sem nome')
              : c.leadName,
          };
        })
      );
    },
    [selectedId]
  );

  const handleDeleteMessage = useCallback(
    async (messageId: string) => {
      if (!selectedId) return;
      const convId = parseInt(selectedId, 10);
      if (Number.isNaN(convId)) return;
      try {
        await whatsappApi.deleteMessage(convId, messageId);
        // Atualização otimista: marca mensagem como deletada localmente
        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId
              ? { ...m, deleted: true, deletedAt: new Date().toISOString(), text: '', attachment: null }
              : m
          )
        );
      } catch (e) {
        console.error('[InboxPage] deleteMessage:', e);
      }
    },
    [selectedId]
  );

  const handleClassificationChange = useCallback(
    async (updates: {
      projectId?: number | null;
      classificationStatus?: string;
      handoff?: boolean;
      leadTemperature?: 'quente' | 'morno' | 'frio';
      reserve?: ReserveSegmentationPatchBody;
      assignedBrokerId?: number | null;
    }) => {
      if (!selectedId) return;
      const id = parseInt(selectedId, 10);
      if (Number.isNaN(id)) return;
      const body: Parameters<typeof whatsappApi.updateClassification>[1] = {};
      if (updates.projectId !== undefined) body.project_id = updates.projectId;
      if (updates.classificationStatus !== undefined) body.classification_status = updates.classificationStatus;
      if (updates.handoff !== undefined) body.handoff = updates.handoff;
      if (updates.leadTemperature !== undefined) {
        body.lead_temperature = updates.leadTemperature;
      }
      if (updates.reserve !== undefined) body.reserve = updates.reserve;
      if (updates.assignedBrokerId !== undefined) body.assigned_broker_id = updates.assignedBrokerId;
      try {
        const data = await whatsappApi.updateClassification(id, body);
        setConversations((prev) =>
          prev.map((c) => {
            let nextTemp: Conversation['temperatura'] = c.temperatura;
            if (data.leadStage === null || data.leadStage === undefined || data.leadStage === '') {
              nextTemp = null;
            } else {
              const ls = data.leadStage.toUpperCase();
              nextTemp = ls === 'HOT' ? 'quente' : ls === 'WARM' ? 'morno' : 'frio';
            }
            return c.id === selectedId
              ? {
                  ...c,
                  projectId: data.projectId ?? c.projectId,
                  projectName: data.projectName ?? c.projectName,
                  classificationStatus: data.classificationStatus ?? c.classificationStatus,
                  status: (data.classificationStatus ?? c.status) as Conversation['status'],
                  empreendimento: data.projectName ?? c.empreendimento,
                  temperatura: nextTemp,
                  enterpriseOriginId:
                    data.enterpriseOriginId !== undefined ? data.enterpriseOriginId : c.enterpriseOriginId,
                  enterpriseOriginName:
                    data.enterpriseOriginName !== undefined ? data.enterpriseOriginName : c.enterpriseOriginName,
                  handoff: data.handoff ?? c.handoff,
                  assignedBrokerName:
                    data.assignedBrokerName !== undefined ? data.assignedBrokerName : c.assignedBrokerName,
                  assignedBrokerId:
                    data.assignedBrokerId !== undefined ? data.assignedBrokerId : c.assignedBrokerId,
                  reserveReason: data.reserveReason ?? c.reserveReason,
                  reserveDesiredCity: data.reserveDesiredCity ?? c.reserveDesiredCity,
                  reservePriceMin: data.reservePriceMin ?? c.reservePriceMin,
                  reservePriceMax: data.reservePriceMax ?? c.reservePriceMax,
                  reservePropertyType: data.reservePropertyType ?? c.reservePropertyType,
                  reserveBedrooms: data.reserveBedrooms ?? c.reserveBedrooms,
                  reserveInterestType: data.reserveInterestType ?? c.reserveInterestType,
                  reserveFollowUpMoment: data.reserveFollowUpMoment ?? c.reserveFollowUpMoment,
                  reserveCommercialNotes: data.reserveCommercialNotes ?? c.reserveCommercialNotes,
                }
              : c;
          })
        );
      } catch (e) {
        if (updates.reserve !== undefined) throw e;
      }
    },
    [selectedId]
  );

  return (
    <div className="h-screen overflow-hidden px-4 pb-4 pt-3 text-[#0f172a] md:p-5">
      <div className="relative flex h-full min-h-0 gap-4">
        <button
          type="button"
          aria-label={sidebarOpen ? 'Fechar lista de conversas' : 'Abrir lista de conversas'}
          onClick={() => setSidebarOpen((o) => !o)}
          className="md:hidden fixed top-5 left-5 z-40 h-10 w-10 flex items-center justify-center rounded-[12px] border border-[#e2e8f0] bg-white text-[#475569] shadow-[0_8px_20px_rgba(15,23,42,0.12)] transition-colors hover:text-[#0f172a]"
        >
          {sidebarOpen ? (
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
          )}
        </button>
        {sidebarOpen && (
          <div className="fixed inset-0 bg-black/25 z-20 md:hidden" aria-hidden onClick={() => setSidebarOpen(false)} />
        )}
        <aside
          className={`w-[360px] shrink-0 min-h-0 overflow-hidden rounded-[22px] border border-[#e2e8f0] bg-white/92 shadow-[0_8px_24px_rgba(15,23,42,0.08)] md:relative md:inset-auto md:z-10 md:translate-x-0 md:transition-[width] md:duration-200 flex flex-col ${conversationPanelCollapsed ? 'md:w-[96px]' : 'md:w-[360px]'} fixed inset-y-4 left-4 right-4 z-30 transform transition-transform duration-200 ease-out sm:right-auto ${sidebarOpen ? 'translate-x-0' : '-translate-x-[110%] md:translate-x-0'}`}
        >
          {!conversationPanelCollapsed && (
            <>
              <div className="shrink-0 border-b border-[#e2e8f0] bg-white px-3 py-3">
                <div className="grid grid-cols-2 rounded-[13px] border border-[#e2e8f0] bg-[#f1f5f9] p-[3px]">
                  <button
                    type="button"
                    onClick={() => handleTabChange('CLIENT')}
                    className={`min-h-[32px] rounded-[10px] px-3 text-[13px] font-semibold transition-all ${
                      activeTab === 'CLIENT'
                        ? 'bg-[#071833] text-white shadow-[0_8px_18px_rgba(7,24,51,0.18)]'
                        : 'text-[#64748b] hover:text-[#0f172a]'
                    }`}
                  >
                    Clientes
                  </button>
                  <button
                    type="button"
                    onClick={() => handleTabChange('INTERNO')}
                    className={`min-h-[32px] rounded-[10px] px-3 text-[13px] font-semibold transition-all ${
                      activeTab === 'INTERNO'
                        ? 'bg-[#071833] text-white shadow-[0_8px_18px_rgba(7,24,51,0.18)]'
                        : 'text-[#64748b] hover:text-[#0f172a]'
                    }`}
                  >
                    Interno
                  </button>
                </div>
              </div>
              <InboxFilterBar
                filters={filters}
                onChange={setFilters}
                projects={projects}
                onClear={clearFilters}
                hasActiveFilters={hasActiveInboxFilters(filters)}
              />
            </>
          )}
          <ConversationList
            conversations={conversations}
            selectedId={selectedId}
            compact={conversationPanelCollapsed}
            hasPendingRealtimeUpdates={hasPendingRealtimeUpdates}
            onScrollMetaChange={({ scrollTop, nearTop }) => {
              conversationListScrollTopRef.current = scrollTop;
              isConversationListNearTopRef.current = nearTop;
            }}
            onApplyRealtimeUpdates={applyPendingRealtimeUpdates}
            onToggleCollapsed={() => setConversationPanelCollapsed((prev) => !prev)}
            onSelect={(id) => {
              const conv = conversations.find((c) => c.id === id);
              markConversationAsRead(id, conv?.updatedAt ?? null);
              setSelectedId(id);
              if (window.matchMedia('(max-width: 767px)').matches) {
                setSidebarOpen(false);
              }
            }}
            onDelete={handleDeleteConversation}
            isLoading={conversationsLoading}
            onNewMessage={() => setNewMessageOpen(true)}
          />
        </aside>
        <main className="min-w-0 min-h-0 flex-1 overflow-hidden rounded-[22px] border border-[#e2e8f0] bg-white/92 shadow-[0_8px_24px_rgba(15,23,42,0.08)]">
          <ChatPanel
            conversation={selectedConversation}
            windowStatus={selectedWindow}
            sendError={sendError}
            messages={messages}
            isLoadingMessages={messagesLoading}
            loadError={messagesError}
            onSendMessage={handleSendMessage}
            isSending={sending}
            onClassificationChange={handleClassificationChange}
            onResetConversation={handleResetConversation}
            onDeleteMessage={handleDeleteMessage}
            onUpdateCustomerName={handleUpdateCustomerName}
            onCloseConversation={handleCloseConversation}
            onReopenConversation={handleReopenConversation}
            projects={projects}
            onScrollContainerRef={(el) => { chatScrollRef.current = el; }}
            showNewMessageIndicator={showNewMessageIndicator}
            onJumpToLatest={() => {
              setShowNewMessageIndicator(false);
              pendingScrollModeRef.current = 'force';
              scheduleScrollToBottom();
            }}
          />
        </main>
      </div>
      <NewMessageModal open={newMessageOpen} onClose={() => setNewMessageOpen(false)} onSent={handleNewMessageSent} />
    </div>
  );
}
