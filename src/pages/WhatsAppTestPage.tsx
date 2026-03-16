import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { whatsappApi } from '../api/client';
import type { ConversationListItem, MessageListItem } from '../api/client';
import { formatMessageTime } from '../utils/format';

export function WhatsAppTestPage() {
  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [conversationsLoading, setConversationsLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageListItem[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [toInput, setToInput] = useState('');
  const [messageInput, setMessageInput] = useState('');
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const selectedConversation = selectedId
    ? (conversations.find((c) => c.id === selectedId) ?? null)
    : null;
  const toDigits = toInput.trim().replace(/[^0-9]/g, '');
  const sendTo = (() => {
    if (selectedConversation) {
      return selectedConversation.contactPhone || selectedConversation.externalContactId || toDigits;
    }
    return toDigits;
  })();

  useEffect(() => {
    let cancelled = false;
    setConversationsLoading(true);
    whatsappApi
      .getConversations()
      .then((data) => {
        if (!cancelled) setConversations(data.conversations);
      })
      .catch(() => {
        if (!cancelled) setConversations([]);
      })
      .finally(() => {
        if (!cancelled) setConversationsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      return;
    }
    const id = parseInt(selectedId, 10);
    if (Number.isNaN(id)) return;
    let cancelled = false;
    setMessagesLoading(true);
    whatsappApi
      .getConversationMessages(id)
      .then((data) => {
        if (!cancelled) setMessages(data.messages);
      })
      .catch(() => {
        if (!cancelled) setMessages([]);
      })
      .finally(() => {
        if (!cancelled) setMessagesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const refreshMessages = useCallback(() => {
    if (!selectedId) return;
    const id = parseInt(selectedId, 10);
    if (Number.isNaN(id)) return;
    whatsappApi.getConversationMessages(id).then((data) => setMessages(data.messages));
  }, [selectedId]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    const to = sendTo.replace(/\D/g, '');
    const text = messageInput.trim();
    if (!to || !text) {
      setSendResult({ type: 'error', text: 'Informe o número e a mensagem.' });
      return;
    }
    setSending(true);
    setSendResult(null);
    whatsappApi
      .send(to, text)
      .then(() => {
        setSendResult({ type: 'success', text: 'Mensagem enviada.' });
        setMessageInput('');
        refreshMessages();
        whatsappApi.getConversations().then((data) => setConversations(data.conversations));
      })
      .catch((err: Error) => {
        setSendResult({ type: 'error', text: err.message ?? 'Erro ao enviar.' });
      })
      .finally(() => setSending(false));
  };

  return (
    <div className="h-screen flex flex-col bg-white text-gray-900">
      <header className="shrink-0 flex items-center justify-between gap-4 px-4 py-2 border-b border-gray-200">
        <Link to="/inbox" className="text-sm text-gray-600 hover:text-gray-900">
          ← Voltar
        </Link>
        <h1 className="text-lg font-semibold">Teste WhatsApp</h1>
        <Link to="/settings/integrations/whatsapp" className="text-sm text-blue-600 hover:text-blue-800">
          Configurações
        </Link>
      </header>

      <div className="flex-1 flex min-h-0">
        <aside className="w-[280px] shrink-0 border-r border-gray-200 flex flex-col bg-white">
          <div className="p-3 border-b border-gray-200">
            <h2 className="text-sm font-medium text-gray-700">Conversas</h2>
          </div>
          <div className="flex-1 overflow-y-auto">
            {conversationsLoading ? (
              <p className="p-4 text-sm text-gray-500">Carregando...</p>
            ) : conversations.length === 0 ? (
              <p className="p-4 text-sm text-gray-500">Nenhuma conversa ainda.</p>
            ) : (
              <ul className="list-none p-0 m-0">
                {conversations.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(c.id)}
                      className={`w-full text-left px-4 py-3 border-b border-gray-100 hover:bg-gray-50 ${
                        selectedId === c.id ? 'bg-blue-50 border-l-2 border-l-blue-500' : ''
                      }`}
                    >
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {c.contactName || c.contactPhone || c.externalContactId || 'Sem nome'}
                      </p>
                      <p className="text-xs text-gray-500 truncate">{c.contactPhone || c.externalContactId}</p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>

        <main className="flex-1 flex flex-col min-w-0">
          {!selectedConversation && sendTo ? (
            <div className="p-4 text-sm text-gray-500">
              Selecione uma conversa ou use o campo abaixo para enviar para um número.
            </div>
          ) : selectedConversation ? (
            <div className="px-4 py-2 border-b border-gray-200">
              <p className="text-sm font-medium text-gray-900">
                {selectedConversation.contactName || selectedConversation.contactPhone || selectedConversation.externalContactId}
              </p>
              <p className="text-xs text-gray-500">{selectedConversation.contactPhone || selectedConversation.externalContactId}</p>
            </div>
          ) : null}

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {messagesLoading ? (
              <p className="text-sm text-gray-500">Carregando mensagens...</p>
            ) : (
              messages.map((m) => {
                const isOut = m.direction === 'outbound';
                return (
                  <div key={m.id} className={`flex ${isOut ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                        isOut ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-900'
                      }`}
                    >
                      <p className="whitespace-pre-wrap">{m.content || '(mídia)'}</p>
                      <p className={`text-xs mt-1 ${isOut ? 'text-blue-100' : 'text-gray-500'}`}>
                        {formatMessageTime(m.createdAt)} {m.status !== 'sent' && m.status !== 'received' ? ` · ${m.status}` : ''}
                      </p>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <form onSubmit={handleSend} className="shrink-0 p-4 border-t border-gray-200 bg-white">
            <div className="flex gap-2 mb-2">
              <input
                type="text"
                value={selectedConversation ? sendTo : toInput}
                onChange={(e) => setToInput(e.target.value)}
                placeholder="Número (ex: 5511999999999)"
                disabled={!!selectedConversation}
                className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:bg-gray-50"
              />
            </div>
            <div className="flex gap-2">
              <textarea
                value={messageInput}
                onChange={(e) => setMessageInput(e.target.value)}
                placeholder="Mensagem..."
                rows={2}
                className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:border-blue-500 focus:ring-1 focus:ring-blue-500 resize-none"
              />
              <button
                type="submit"
                disabled={sending || !messageInput.trim()}
                className="px-4 py-2 bg-blue-500 text-white text-sm font-medium rounded-lg hover:bg-blue-600 disabled:opacity-50"
              >
                {sending ? 'Enviando...' : 'Enviar'}
              </button>
            </div>
            {sendResult && (
              <p className={`mt-2 text-sm ${sendResult.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>
                {sendResult.text}
              </p>
            )}
          </form>
        </main>
      </div>
    </div>
  );
}
