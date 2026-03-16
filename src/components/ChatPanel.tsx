import { useEffect, useRef } from 'react';
import type { Conversation, Message, Empreendimento } from '../types';
import { MessageBubble } from './MessageBubble';
import { ChatComposer } from './ChatComposer';
import { FlameIcon } from './FlameIcon';
import { formatDateSeparator, formatStatus } from '../utils/format';

const empreendimentoStyles: Record<Empreendimento, string> = {
  Montaresa: 'bg-violet-100 text-violet-800 border-violet-200',
  Evora: 'bg-amber-100 text-amber-800 border-amber-200',
};

const STATUS_OPTIONS: { value: 'Novo' | 'Handoff'; label: string }[] = [
  { value: 'Novo', label: 'Novo' },
  { value: 'Handoff', label: 'Handoff' },
];

interface ChatPanelProps {
  conversation: Conversation | null;
  messages: Message[];
  isLoadingMessages: boolean;
  loadError: string | null;
  onSendMessage: (text: string) => void;
  onClassificationChange?: (updates: { projectId?: number | null; classificationStatus?: string }) => void;
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
      <div className="flex-1 flex items-center justify-center bg-white text-gray-500 p-8">
        <p className="text-center">Selecione uma conversa à esquerda</p>
      </div>
    );
  }

  const displayName = conversation.leadName.trim() || 'Lead sem nome';

  let lastDate = '';

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <header className="shrink-0 px-5 py-4 border-b border-gray-200">
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-semibold text-gray-900 truncate leading-tight">{displayName}</h3>
            {conversation.leadPhone && (
              <p className="text-sm text-gray-600 truncate mt-0.5">{conversation.leadPhone}</p>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {(conversation.projectName || conversation.empreendimento) && (
              <span
                className={`inline-flex items-center text-xs font-medium px-2.5 py-1 rounded border ${
                  conversation.empreendimento ? empreendimentoStyles[conversation.empreendimento] : 'bg-gray-100 text-gray-700 border-gray-200'
                }`}
                title="Projeto"
              >
                {conversation.projectName || conversation.empreendimento}
              </span>
            )}
            <span title={`Lead ${conversation.temperatura}`} className="inline-flex items-center p-1">
              <FlameIcon temperatura={conversation.temperatura} size="md" />
            </span>
            <span className="text-xs font-medium px-2.5 py-1 rounded bg-gray-200 text-gray-700">
              {formatStatus(conversation.status)}
            </span>
          </div>
        </div>
        {onClassificationChange && (
          <div className="flex flex-wrap gap-3 mt-3 pt-3 border-t border-gray-100">
            <label className="flex items-center gap-2">
              <span className="text-sm text-gray-600">Projeto:</span>
              <select
                value={conversation.projectId ?? ''}
                onChange={(e) => {
                  const v = e.target.value;
                  onClassificationChange({
                    projectId: v === '' ? null : Number(v),
                  });
                }}
                className="text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              >
                <option value="">— Empreendimento</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2">
              <span className="text-sm text-gray-600">Status:</span>
              <select
                value={conversation.classificationStatus ?? conversation.status ?? 'Novo'}
                onChange={(e) => {
                  onClassificationChange({ classificationStatus: e.target.value as 'Novo' | 'Handoff' });
                }}
                className="text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              >
                {STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
      </header>

      {/* Messages */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto min-h-0 p-4">
        {loadError ? (
          <p className="text-center text-red-600 py-8">Falha ao carregar</p>
        ) : isLoadingMessages ? (
          <div className="flex items-center justify-center py-12 text-gray-500">Carregando...</div>
        ) : messages.length === 0 ? (
          <p className="text-center text-gray-500 py-8">Sem mensagens ainda</p>
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
                      <span className="text-xs text-gray-400 bg-gray-100 px-3 py-1 rounded-full">
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

      {/* Composer */}
      {!loadError && !isLoadingMessages && (
        <ChatComposer onSend={onSendMessage} disabled={isSending} />
      )}
    </div>
  );
}
