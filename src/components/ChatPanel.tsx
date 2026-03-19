import { useEffect, useRef } from 'react';
import type { Conversation, Message } from '../types';
import { MessageBubble } from './MessageBubble';
import { ChatComposer } from './ChatComposer';
import { FlameIcon } from './FlameIcon';
import { formatDateSeparator, formatStatus } from '../utils/format';

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'Novo', label: 'Novo' },
  { value: 'Qualificado', label: 'Qualificado' },
  { value: 'Reserva', label: 'Reserva' },
  { value: 'Handoff', label: 'Handoff' },
];

const selectField =
  'text-[13px] border border-[#E5E7EB] rounded-[8px] px-2.5 py-[6px] bg-white transition focus:border-[#3B82F6] focus:ring-[3px] focus:ring-[rgba(59,130,246,0.15)] focus:outline-none';

interface ChatPanelProps {
  conversation: Conversation | null;
  messages: Message[];
  isLoadingMessages: boolean;
  loadError: string | null;
  onSendMessage: (text: string) => void;
  onClassificationChange?: (updates: { projectId?: number | null; classificationStatus?: string; handoff?: boolean }) => void;
  projects?: { id: number; name: string; active: boolean }[];
  isSending?: boolean;
}

export function ChatPanel({
  conversation,
  messages,
  isLoadingMessages,
  loadError,
  onSendMessage,
  onClassificationChange,
  projects = [],
  isSending = false,
}: ChatPanelProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (!conversation) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-[#F9FAFB] text-[#6B7280] p-8">
        <div className="w-14 h-14 rounded-full bg-[#EFF6FF] flex items-center justify-center mb-4">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        </div>
        <p className="text-[15px] font-medium text-[#111827] mb-1">Selecione uma conversa</p>
        <p className="text-[13px] text-[#9CA3AF]">Escolha uma conversa na lista à esquerda para começar.</p>
      </div>
    );
  }

  const displayName = conversation.leadName.trim() || 'Lead sem nome';
  let lastDate = '';

  return (
    <div className="flex flex-col h-full bg-white">
      <header className="shrink-0 px-5 py-4 border-b border-[#E5E7EB] bg-white">
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex-1 min-w-0">
            <h3 className="text-[15px] font-semibold text-[#111827] truncate leading-tight">{displayName}</h3>
            {conversation.leadPhone && (
              <p className="text-[13px] text-[#6B7280] truncate mt-0.5">{conversation.leadPhone}</p>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {(conversation.projectName || conversation.empreendimento) && (
              <span className="inline-flex items-center text-[11px] font-semibold px-2.5 py-1 rounded-[6px] bg-[#EFF6FF] text-[#3B82F6]">
                {conversation.projectName || conversation.empreendimento}
              </span>
            )}
            <span title={`Lead ${conversation.temperatura}`} className="inline-flex items-center p-1">
              <FlameIcon temperatura={conversation.temperatura} size="md" />
            </span>
            <span className="text-[11px] font-medium px-2.5 py-1 rounded-[6px] bg-[#F3F4F6] text-[#6B7280]">
              {formatStatus(conversation.status)}
            </span>
          </div>
        </div>
        {onClassificationChange && (
          <div className="flex flex-wrap gap-3 mt-3 pt-3 border-t border-[#F3F4F6]">
            <div className="flex items-center gap-2">
              <span className="text-[13px] text-[#6B7280]">Modo:</span>
              <div
                role="group"
                aria-label="Modo da conversa"
                className="inline-flex p-0.5 rounded-[10px] bg-[#F3F4F6] border border-[#E5E7EB] transition-all duration-200"
              >
                <button
                  type="button"
                  onClick={() => onClassificationChange({ handoff: false })}
                  title="ANA: resposta automática da ANA"
                  className={`px-4 py-2 rounded-[8px] text-[13px] font-medium transition-all duration-200 ${
                    !conversation.handoff
                      ? 'bg-[#F97316] text-white shadow-sm'
                      : 'text-[#6B7280] hover:text-[#111827] hover:bg-[#E5E7EB]/60'
                  }`}
                >
                  ANA
                </button>
                <button
                  type="button"
                  onClick={() => onClassificationChange({ handoff: true })}
                  title="Handoff: apenas atendimento humano"
                  className={`px-4 py-2 rounded-[8px] text-[13px] font-medium transition-all duration-200 ${
                    conversation.handoff
                      ? 'bg-[#F97316] text-white shadow-sm'
                      : 'text-[#6B7280] hover:text-[#111827] hover:bg-[#E5E7EB]/60'
                  }`}
                >
                  Handoff
                </button>
              </div>
            </div>
            <label className="flex items-center gap-2">
              <span className="text-[13px] text-[#6B7280]">Projeto:</span>
              <select
                value={conversation.projectId ?? ''}
                onChange={(e) => {
                  const v = e.target.value;
                  onClassificationChange({ projectId: v === '' ? null : Number(v) });
                }}
                className={selectField}
              >
                <option value="">— Empreendimento</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-2">
              <span className="text-[13px] text-[#6B7280]">Status:</span>
              <select
                value={conversation.classificationStatus ?? conversation.status ?? 'Novo'}
                onChange={(e) => { onClassificationChange({ classificationStatus: e.target.value }); }}
                className={selectField}
              >
                {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
          </div>
        )}
      </header>

      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto min-h-0 p-4 bg-[#F9FAFB]">
        {loadError ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center mb-3">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            </div>
            <p className="text-[13px] text-red-600">Falha ao carregar mensagens</p>
          </div>
        ) : isLoadingMessages ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <div className="h-5 w-5 rounded-full border-2 border-[#3B82F6] border-t-transparent animate-spin" />
            <span className="text-[13px] text-[#6B7280]">Carregando…</span>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <p className="text-[13px] text-[#9CA3AF]">Sem mensagens ainda</p>
          </div>
        ) : (
          <>
            {messages.map((msg) => {
              const dateLabel = formatDateSeparator(msg.createdAt);
              const showDate = dateLabel !== lastDate;
              if (showDate) lastDate = dateLabel;
              return (
                <div key={msg.id}>
                  {showDate && (
                    <div className="flex justify-center my-4">
                      <span className="text-[11px] font-medium text-[#9CA3AF] bg-white border border-[#E5E7EB] px-3 py-1 rounded-full shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
                        {dateLabel}
                      </span>
                    </div>
                  )}
                  <MessageBubble message={msg} />
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {!loadError && !isLoadingMessages && (
        <ChatComposer onSend={onSendMessage} disabled={isSending} />
      )}
    </div>
  );
}
