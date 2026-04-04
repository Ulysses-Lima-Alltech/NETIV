import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AppNav } from '../components/AppNav';
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
import {
  InboxFilterBar,
  DEFAULT_INBOX_FILTERS,
  hasActiveInboxFilters,
  inboxFiltersToApiParams,
  type InboxFilters,
} from '../components/InboxFilterBar';

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

export function InboxPage() {
  const [searchParams] = useSearchParams();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationsLoading, setConversationsLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [newMessageOpen, setNewMessageOpen] = useState(false);
  const [projects, setProjects] = useState<{ id: number; name: string; active: boolean }[]>([]);
  const [filters, setFilters] = useState<InboxFilters>(DEFAULT_INBOX_FILTERS);
  const [searchDebounced, setSearchDebounced] = useState(filters.search);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  /** Evita reprocessar o mesmo `conversationId` da URL (sucesso ou falha) em loop. */
  const deepLinkConsumedParamRef = useRef<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);

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

  const selectedConversation = selectedId
    ? conversations.find((c) => c.id === selectedId) ?? null
    : null;
  const selectedWindow = selectedConversation?.whatsappWindow ?? null;

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  const loadConversations = useCallback((silent?: boolean) => {
    if (!silent) setConversationsLoading(true);
    const params = inboxFiltersToApiParams({ ...filters, search: searchDebounced });
    return whatsappApi
      .getConversations({ ...params, limit: 200 })
      .then((data) => {
        const mapped = data.conversations.map(mapApiConversationToConversation);
        setConversations((prev) => {
          const sid = selectedIdRef.current;
          if (!sid) return mapped;
          if (mapped.some((c) => c.id === sid)) return mapped;
          const orphan = prev.find((c) => c.id === sid);
          if (orphan) return [orphan, ...mapped];
          return mapped;
        });
      })
      .catch(() => setConversations([]))
      .finally(() => { if (!silent) setConversationsLoading(false); });
  }, [filters, searchDebounced]);

  const loadMessages = useCallback((convId: string, silent?: boolean) => {
    const id = parseInt(convId, 10);
    if (Number.isNaN(id)) return;
    const shouldScroll = isUserAtBottom();
    if (!silent) setMessagesLoading(true);
    if (!silent) setMessagesError(null);
    if (!silent) setSendError(null);
    whatsappApi
      .getConversationMessages(id)
      .then((data) => {
        const windowStatus: WhatsAppWindowStatus | undefined = data.window;
        setConversations((prev) =>
          prev.map((c) => (c.id === convId ? { ...c, whatsappWindow: windowStatus ?? c.whatsappWindow } : c))
        );
        const apiMapped = data.messages
          .map((m) => mapApiMessageToMessage(m, convId))
          .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        let isNewConversation = false;
        setMessages((prev) => {
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
        if (isNewConversation) {
          setTimeout(() => scrollToBottom(), 0);
        } else if (shouldScroll) {
          setTimeout(() => scrollToBottom(), 0);
        }
      })
      .catch(() => { if (!silent) setMessagesError('Falha ao carregar'); })
      .finally(() => { if (!silent) setMessagesLoading(false); });
  }, [isUserAtBottom, scrollToBottom]);

  useEffect(() => { loadConversations(); }, [loadConversations]);

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
    loadMessages(selectedId);
  }, [selectedId, loadMessages]);

  const POLL_INTERVAL_MS = 5000;
  useEffect(() => {
    const interval = setInterval(() => {
      loadConversations(true);
      if (selectedId) loadMessages(selectedId, true);
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [loadConversations, loadMessages, selectedId]);

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
        setTimeout(() => scrollToBottom(), 0);
      }
      try {
        await whatsappApi.sendToConversation(id, text, file ?? null);
        setMessages((prev) => prev.map((m) => (m.id === tempMessage.id ? { ...tempMessage, id: `sent-${Date.now()}` } : m)));
        loadConversations();
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
    [selectedId, selectedWindow, loadConversations, isUserAtBottom, scrollToBottom]
  );

  const handleNewMessageSent = useCallback(
    (conversationId: number | undefined) => {
      setNewMessageOpen(false);
      loadConversations();
      if (conversationId != null) setSelectedId(String(conversationId));
    },
    [loadConversations]
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
        await loadConversations(true);
        if (selectedIdRef.current === conversationIdStr) {
          loadMessages(conversationIdStr, true);
        }
      } catch (e) {
        console.error('[InboxPage] resetConversation:', e);
      }
    },
    [loadConversations, loadMessages]
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
    <div className="h-screen flex flex-col bg-[#F9FAFB] text-[#111827]">
      <nav className="shrink-0 flex items-center justify-between px-5 h-14 border-b border-[#E5E7EB] bg-white/80 backdrop-blur-sm sticky top-0 z-30">
        <span className="text-[15px] font-semibold text-[#111827]">Inbox</span>
        <AppNav />
      </nav>

      <div className="flex-1 flex flex-col md:flex-row min-h-0">
        <button
          type="button"
          aria-label={sidebarOpen ? 'Fechar lista de conversas' : 'Abrir lista de conversas'}
          onClick={() => setSidebarOpen((o) => !o)}
          className="md:hidden fixed top-[68px] left-4 z-20 w-9 h-9 flex items-center justify-center bg-white border border-[#E5E7EB] rounded-[10px] shadow-sm text-[#6B7280] hover:text-[#111827] transition-colors"
        >
          {sidebarOpen ? (
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
          )}
        </button>
        {sidebarOpen && (
          <div className="fixed inset-0 bg-black/30 z-10 md:hidden" aria-hidden onClick={() => setSidebarOpen(false)} />
        )}
        <aside className={`w-[340px] shrink-0 flex flex-col h-full md:relative md:translate-x-0 fixed inset-y-0 left-0 z-20 transform transition-transform duration-200 ease-out ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
          <InboxFilterBar
            filters={filters}
            onChange={setFilters}
            projects={projects}
            onClear={clearFilters}
            hasActiveFilters={hasActiveInboxFilters(filters)}
          />
          <ConversationList
            conversations={conversations}
            selectedId={selectedId}
            onSelect={(id) => { setSelectedId(id); setSidebarOpen(false); }}
            onDelete={handleDeleteConversation}
            isLoading={conversationsLoading}
            onNewMessage={() => setNewMessageOpen(true)}
          />
        </aside>
        <main className="flex-1 flex flex-col min-w-0 min-h-0">
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
          />
        </main>
      </div>
      <NewMessageModal open={newMessageOpen} onClose={() => setNewMessageOpen(false)} onSent={handleNewMessageSent} />
    </div>
  );
}
