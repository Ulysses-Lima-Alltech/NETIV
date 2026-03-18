import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import type { Conversation, Message } from '../types';
import { whatsappApi, projectsApi } from '../api/client';
import type { ConversationListItem as ApiConversation, MessageListItem } from '../api/client';
import { ConversationList } from '../components/ConversationList';
import { ChatPanel } from '../components/ChatPanel';
import { NewMessageModal } from '../components/NewMessageModal';

function mapApiConversationToConversation(c: ApiConversation): Conversation {
  const leadName = c.contactName?.trim() || c.contactPhone || c.externalContactId || 'Sem nome';
  const leadPhone = c.contactPhone || c.externalContactId || '';
  const leadStage = (c.leadStage || '').toUpperCase();
  const temperatura = leadStage === 'HOT' ? 'quente' : leadStage === 'WARM' ? 'morno' : 'frio';
  const projectName = c.projectName ?? null;
  const empreendimento = projectName;
  const status = (['Handoff', 'Qualificando', 'Interessado', 'Novo'].includes(c.classificationStatus)
    ? c.classificationStatus
    : 'Novo') as Conversation['status'];
  return {
    id: c.id,
    leadName,
    leadPhone,
    lastMessage: c.lastMessagePreview || '',
    updatedAt: c.lastMessageAt || c.updatedAt || c.createdAt,
    unreadCount: 0,
    status,
    empreendimento,
    temperatura,
    projectId: c.projectId ?? null,
    projectName: projectName ?? null,
    classificationStatus: c.classificationStatus || 'Novo',
  };
}

function mapApiMessageToMessage(m: MessageListItem, conversationId: string): Message {
  return {
    id: String(m.id),
    conversationId,
    sender: m.direction === 'inbound' ? 'LEAD' : 'AGENT',
    text: m.content || '',
    createdAt: m.createdAt,
  };
}

export function InboxPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationsLoading, setConversationsLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [newMessageOpen, setNewMessageOpen] = useState(false);
  const [projects, setProjects] = useState<{ id: number; name: string; active: boolean }[]>([]);

  const selectedConversation = selectedId
    ? conversations.find((c) => c.id === selectedId) ?? null
    : null;

  const loadConversations = useCallback((silent?: boolean) => {
    if (!silent) setConversationsLoading(true);
    whatsappApi
      .getConversations()
      .then((data) => {
        setConversations(data.conversations.map(mapApiConversationToConversation));
      })
      .catch(() => setConversations([]))
      .finally(() => { if (!silent) setConversationsLoading(false); });
  }, []);

  const loadMessages = useCallback((convId: string, silent?: boolean) => {
    const id = parseInt(convId, 10);
    if (Number.isNaN(id)) return;
    if (!silent) setMessagesLoading(true);
    if (!silent) setMessagesError(null);
    whatsappApi
      .getConversationMessages(id)
      .then((data) => {
        setMessages(
          data.messages.map((m) => mapApiMessageToMessage(m, convId)).sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
        );
      })
      .catch(() => { if (!silent) setMessagesError('Falha ao carregar'); })
      .finally(() => { if (!silent) setMessagesLoading(false); });
  }, []);

  useEffect(() => { loadConversations(); }, [loadConversations]);

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
    async (text: string) => {
      if (!selectedId) return;
      const id = parseInt(selectedId, 10);
      if (Number.isNaN(id)) return;
      setSending(true);
      const tempMessage: Message = {
        id: `temp-${Date.now()}`,
        conversationId: selectedId,
        sender: 'AGENT',
        text,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, tempMessage]);
      try {
        await whatsappApi.sendToConversation(id, text);
        setMessages((prev) => prev.map((m) => (m.id === tempMessage.id ? { ...tempMessage, id: `sent-${Date.now()}` } : m)));
        loadConversations();
      } catch {
        setMessages((prev) => prev.filter((m) => m.id !== tempMessage.id));
      } finally {
        setSending(false);
      }
    },
    [selectedId, loadConversations]
  );

  const handleNewMessageSent = useCallback(
    (conversationId: number | undefined) => {
      setNewMessageOpen(false);
      loadConversations();
      if (conversationId != null) setSelectedId(String(conversationId));
    },
    [loadConversations]
  );

  const handleClassificationChange = useCallback(
    (updates: { projectId?: number | null; classificationStatus?: string }) => {
      if (!selectedId) return;
      const id = parseInt(selectedId, 10);
      if (Number.isNaN(id)) return;
      whatsappApi
        .updateClassification(id, {
          project_id: updates.projectId,
          classification_status: updates.classificationStatus,
        })
        .then((data) => {
          setConversations((prev) =>
            prev.map((c) =>
              c.id === selectedId
                ? {
                    ...c,
                    projectId: data.projectId ?? c.projectId,
                    projectName: data.projectName ?? c.projectName,
                    classificationStatus: data.classificationStatus ?? c.classificationStatus,
                    status: (data.classificationStatus ?? c.status) as Conversation['status'],
                    empreendimento: data.projectName ?? c.empreendimento,
                  }
                : c
            )
          );
        })
        .catch(() => {});
    },
    [selectedId]
  );

  return (
    <div className="h-screen flex flex-col bg-[#F9FAFB] text-[#111827]">
      <nav className="shrink-0 flex items-center justify-between px-5 h-14 border-b border-[#E5E7EB] bg-white/80 backdrop-blur-sm sticky top-0 z-30">
        <span className="text-[15px] font-semibold text-[#111827]">Inbox</span>
        <div className="flex items-center gap-5">
          <Link to="/settings/empreendimentos" className="text-[13px] font-medium text-[#3B82F6] hover:text-[#1D4ED8] transition-colors">
            Empreendimentos
          </Link>
          <Link to="/settings/integrations/whatsapp" className="text-[13px] font-medium text-[#3B82F6] hover:text-[#1D4ED8] transition-colors">
            Configurações
          </Link>
          <Link to="/enviar-whatsapp" className="text-[13px] font-medium text-[#6B7280] hover:text-[#111827] transition-colors">
            Enviar WhatsApp
          </Link>
        </div>
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
          <ConversationList
            conversations={conversations}
            selectedId={selectedId}
            onSelect={(id) => { setSelectedId(id); setSidebarOpen(false); }}
            isLoading={conversationsLoading}
            onNewMessage={() => setNewMessageOpen(true)}
          />
        </aside>
        <main className="flex-1 flex flex-col min-w-0 min-h-0">
          <ChatPanel
            conversation={selectedConversation}
            messages={messages}
            isLoadingMessages={messagesLoading}
            loadError={messagesError}
            onSendMessage={handleSendMessage}
            isSending={sending}
            onClassificationChange={handleClassificationChange}
            projects={projects}
          />
        </main>
      </div>
      <NewMessageModal open={newMessageOpen} onClose={() => setNewMessageOpen(false)} onSent={handleNewMessageSent} />
    </div>
  );
}
