import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { whatsappApi } from '../api/client';
import type { ConversationListItem, MessageListItem } from '../api/client';
import { formatMessageTime } from '../utils/format';

const field =
  'w-full border border-[#E5E7EB] rounded-[10px] px-3.5 py-[10px] text-[14px] text-[#111827] placeholder:text-[#9CA3AF] bg-white transition focus:border-[#3B82F6] focus:ring-[3px] focus:ring-[rgba(59,130,246,0.15)] focus:outline-none';

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

  const selectedConversation = selectedId ? (conversations.find((c) => c.id === selectedId) ?? null) : null;
  const toDigits = toInput.trim().replace(/[^0-9]/g, '');
  const sendTo = (() => {
    if (selectedConversation) return selectedConversation.contactPhone || selectedConversation.externalContactId || toDigits;
    return toDigits;
  })();

  useEffect(() => {
    let cancelled = false;
    setConversationsLoading(true);
    whatsappApi.getConversations()
      .then((data) => { if (!cancelled) setConversations(data.conversations); })
      .catch(() => { if (!cancelled) setConversations([]); })
      .finally(() => { if (!cancelled) setConversationsLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!selectedId) { setMessages([]); return; }
    const id = parseInt(selectedId, 10);
    if (Number.isNaN(id)) return;
    let cancelled = false;
    setMessagesLoading(true);
    whatsappApi.getConversationMessages(id)
      .then((data) => { if (!cancelled) setMessages(data.messages); })
      .catch(() => { if (!cancelled) setMessages([]); })
      .finally(() => { if (!cancelled) setMessagesLoading(false); });
    return () => { cancelled = true; };
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
    if (!to || !text) { setSendResult({ type: 'error', text: 'Informe o número e a mensagem.' }); return; }
    setSending(true);
    setSendResult(null);
    whatsappApi.send(to, text)
      .then(() => {
        setSendResult({ type: 'success', text: 'Mensagem enviada.' });
        setMessageInput('');
        refreshMessages();
        whatsappApi.getConversations().then((data) => setConversations(data.conversations));
      })
      .catch((err: Error) => { setSendResult({ type: 'error', text: err.message ?? 'Erro ao enviar.' }); })
      .finally(() => setSending(false));
  };

  return (
    <div className="h-screen flex flex-col bg-[#F9FAFB] text-[#111827]">
      <header className="shrink-0 flex items-center gap-4 px-5 h-14 border-b border-[#E5E7EB] bg-white/80 backdrop-blur-sm">
        <Link to="/inbox" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#3B82F6] hover:text-[#1D4ED8] transition-colors">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
          Inbox
        </Link>
        <div className="h-4 w-px bg-[#E5E7EB]" />
        <h1 className="text-[15px] font-semibold text-[#111827]">Teste WhatsApp</h1>
        <Link to="/settings/integrations/whatsapp" className="ml-auto text-[13px] font-medium text-[#3B82F6] hover:text-[#1D4ED8] transition-colors">Configurações</Link>
      </header>

      <div className="flex-1 flex min-h-0">
        <aside className="w-[280px] shrink-0 border-r border-[#E5E7EB] flex flex-col bg-white">
          <div className="px-4 py-3.5 border-b border-[#E5E7EB]">
            <h2 className="text-[13px] font-semibold text-[#111827]">Conversas</h2>
          </div>
          <div className="flex-1 overflow-y-auto">
            {conversationsLoading ? (
              <div className="flex items-center gap-2 p-4">
                <div className="h-4 w-4 rounded-full border-2 border-[#3B82F6] border-t-transparent animate-spin" />
                <span className="text-[13px] text-[#6B7280]">Carregando…</span>
              </div>
            ) : conversations.length === 0 ? (
              <p className="p-4 text-[13px] text-[#9CA3AF]">Nenhuma conversa ainda.</p>
            ) : (
              <nav className="space-y-0">
                {conversations.map((c) => {
                  const active = selectedId === c.id;
                  return (
                    <button key={c.id} type="button" onClick={() => setSelectedId(c.id)}
                      className={`w-full text-left px-4 py-3 border-b border-[#F3F4F6] transition-all ${active ? 'bg-[#EFF6FF] border-l-[3px] border-l-[#3B82F6]' : 'hover:bg-[#F9FAFB]'}`}>
                      <p className={`text-[13px] font-medium truncate ${active ? 'text-[#1D4ED8]' : 'text-[#111827]'}`}>
                        {c.contactName || c.contactPhone || c.externalContactId || 'Sem nome'}
                      </p>
                      <p className="text-[12px] text-[#9CA3AF] truncate">{c.contactPhone || c.externalContactId}</p>
                    </button>
                  );
                })}
              </nav>
            )}
          </div>
        </aside>

        <main className="flex-1 flex flex-col min-w-0">
          {!selectedConversation && sendTo ? (
            <div className="flex items-center justify-center p-6">
              <p className="text-[13px] text-[#9CA3AF]">Selecione uma conversa ou use o campo abaixo para enviar.</p>
            </div>
          ) : selectedConversation ? (
            <div className="px-5 py-3.5 border-b border-[#E5E7EB] bg-white">
              <p className="text-[14px] font-semibold text-[#111827]">{selectedConversation.contactName || selectedConversation.contactPhone || selectedConversation.externalContactId}</p>
              <p className="text-[12px] text-[#6B7280]">{selectedConversation.contactPhone || selectedConversation.externalContactId}</p>
            </div>
          ) : null}

          <div className="flex-1 overflow-y-auto p-4 bg-[#F9FAFB]">
            {messagesLoading ? (
              <div className="flex flex-col items-center justify-center py-12 gap-3">
                <div className="h-5 w-5 rounded-full border-2 border-[#3B82F6] border-t-transparent animate-spin" />
                <span className="text-[13px] text-[#6B7280]">Carregando…</span>
              </div>
            ) : (
              <div className="space-y-2.5">
                {messages.map((m) => {
                  const isOut = m.direction === 'outbound';
                  return (
                    <div key={m.id} className={`flex ${isOut ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 shadow-[0_1px_2px_rgba(0,0,0,0.06)] ${isOut ? 'bg-[#3B82F6] text-white rounded-br-md' : 'bg-white text-[#111827] border border-[#E5E7EB] rounded-bl-md'}`}>
                        <p className="text-[14px] whitespace-pre-wrap">{m.content || '(mídia)'}</p>
                        <p className={`text-[11px] mt-1.5 ${isOut ? 'text-white/60' : 'text-[#9CA3AF]'}`}>
                          {formatMessageTime(m.createdAt)} {m.status !== 'sent' && m.status !== 'received' ? ` · ${m.status}` : ''}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <form onSubmit={handleSend} className="shrink-0 p-4 border-t border-[#E5E7EB] bg-white space-y-3">
            <input type="text" value={selectedConversation ? sendTo : toInput} onChange={(e) => setToInput(e.target.value)} placeholder="Número (ex: 5511999999999)" disabled={!!selectedConversation} className={`${field} disabled:bg-[#F9FAFB] disabled:text-[#9CA3AF]`} />
            <div className="flex gap-3">
              <textarea value={messageInput} onChange={(e) => setMessageInput(e.target.value)} placeholder="Mensagem..." rows={2} className={`flex-1 ${field} resize-none`} />
              <button type="submit" disabled={sending || !messageInput.trim()} className="shrink-0 inline-flex items-center gap-1.5 px-5 py-[10px] text-[14px] font-semibold text-white bg-[#F97316] rounded-[10px] hover:bg-[#EA580C] active:bg-[#C2410C] disabled:opacity-40 transition-colors shadow-sm">
                {sending ? (
                  <span className="h-4 w-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                )}
                Enviar
              </button>
            </div>
            {sendResult && <p className={`text-[13px] ${sendResult.type === 'success' ? 'text-emerald-600' : 'text-red-600'}`}>{sendResult.text}</p>}
          </form>
        </main>
      </div>
    </div>
  );
}
