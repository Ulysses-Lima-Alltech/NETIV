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
  const empreendimento = projectName === 'Evora' || projectName === 'Montaresa' ? projectName : null;
  const status = (c.classificationStatus === 'Handoff' ? 'Handoff' : 'Novo') as Conversation['status'];
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

  const loadConversations = useCallback(() => {
    setConversationsLoading(true);
    whatsappApi
      .getConversations()
      .then((data) => {
        setConversations(data.conversations.map(mapApiConversationToConversation));
      })
      .catch(() => setConversations([]))
      .finally(() => setConversationsLoading(false));
  }, []);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    projectsApi
      .list(true)
      .then((data) => setProjects(data.projects))
      .catch(() => setProjects([]));
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      setMessagesError(null);
      return;
    }
    const id = parseInt(selectedId, 10);
    if (Number.isNaN(id)) return;
    let cancelled = false;
    setMessagesLoading(true);
    setMessagesError(null);
    whatsappApi
      .getConversationMessages(id)
      .then((data) => {
        if (!cancelled) {
          setMessages(
            data.messages.map((m) => mapApiMessageToMessage(m, selectedId)).sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
          );
        }
      })
      .catch(() => {
        if (!cancelled) setMessagesError('Falha ao carregar');
      })
      .finally(() => {
        if (!cancelled) setMessagesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

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
                    empreendimento: data.projectName === 'Evora' || data.projectName === 'Montaresa' ? data.projectName : data.projectName ? null : c.empreendimento,
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
    <div className="h-screen flex flex-col bg-white text-gray-900">
      <nav className="shrink-0 flex items-center justify-end gap-4 px-4 py-2 border-b border-gray-200 bg-white">
        <Link to="/settings/integrations/whatsapp" className="text-sm text-blue-600 hover:text-blue-800">
          Configurações
        </Link>
        <Link to="/enviar-whatsapp" className="text-sm text-gray-500 hover:text-gray-700">Enviar WhatsApp (técnico)</Link>
      </nav>
      <div className="flex-1 flex flex-col md:flex-row min-h-0">
        <button
          type="button"
          aria-label={sidebarOpen ? 'Fechar lista de conversas' : 'Abrir lista de conversas'}
          onClick={() => setSidebarOpen((o) => !o)}
          className="md:hidden fixed top-14 left-4 z-20 px-3 py-2 bg-white border border-gray-200 rounded-lg shadow-sm"
        >
          {sidebarOpen ? '✕' : '☰'}
        </button>
        {sidebarOpen && (
          <div className="fixed inset-0 bg-black/30 z-10 md:hidden" aria-hidden onClick={() => setSidebarOpen(false)} />
        )}
        <aside
          className={`
          w-[320px] shrink-0 flex flex-col h-full md:relative md:translate-x-0
          fixed inset-y-0 left-0 z-20 transform transition-transform duration-200 ease-out
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
        >
          <ConversationList
            conversations={conversations}
            selectedId={selectedId}
            onSelect={(id) => {
              setSelectedId(id);
              setSidebarOpen(false);
            }}
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
      <NewMessageModal
        open={newMessageOpen}
        onClose={() => setNewMessageOpen(false)}
        onSent={handleNewMessageSent}
      />
    </div>
  );
}
