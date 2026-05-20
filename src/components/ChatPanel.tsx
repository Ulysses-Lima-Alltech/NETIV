import { useCallback, useEffect, useRef, useState } from 'react';
import type { Conversation, Message } from '../types';
import { MessageBubble } from './MessageBubble';
import { ChatComposer } from './ChatComposer';
import { FlameIcon } from './FlameIcon';
import { formatBrlRange, formatDateSeparator, formatStatus } from '../utils/format';
import {
  RESERVE_INTEREST_LABELS,
  RESERVE_INTEREST_TYPES,
  RESERVE_REASON_LABELS,
  RESERVE_REASONS,
  type ReserveInterestType,
  type ReserveReason,
} from '../constants/reserveSegmentation';
import type { ReserveSegmentationPatchBody } from '../api/client';
import { corretoresApi } from '../api/client';

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'Novo', label: 'Novo' },
  { value: 'Qualificado', label: 'Qualificado' },
  { value: 'Carteira', label: 'Carteira' },
  { value: 'Handoff', label: 'Handoff' },
];

const DETAILS_PANEL_KEY = 'inbox_chat_details_open_v1';

const selectField =
  'text-[13px] border border-[#E5E7EB] rounded-[8px] px-2.5 py-[6px] bg-white transition focus:border-[#3B82F6] focus:ring-[3px] focus:ring-[rgba(59,130,246,0.15)] focus:outline-none';

const inputField =
  'w-full text-[13px] border border-[#E5E7EB] rounded-[8px] px-2.5 py-[6px] bg-white focus:border-[#3B82F6] focus:ring-[3px] focus:ring-[rgba(59,130,246,0.15)] focus:outline-none';

const labelSm = 'block text-[11px] font-medium text-[#6B7280] mb-1';

interface ReserveDraft {
  reason: string;
  desiredCity: string;
  priceMin: string;
  priceMax: string;
  propertyType: string;
  bedrooms: string;
  interestType: string;
  followUpMoment: string;
  commercialNotes: string;
}

function reserveFingerprint(c: Conversation): string {
  return [
    c.reserveReason ?? '',
    c.reserveDesiredCity ?? '',
    c.reservePriceMin ?? '',
    c.reservePriceMax ?? '',
    c.reservePropertyType ?? '',
    c.reserveBedrooms ?? '',
    c.reserveInterestType ?? '',
    c.reserveFollowUpMoment ?? '',
    c.reserveCommercialNotes ?? '',
  ].join('\x1e');
}

function conversationToDraft(c: Conversation): ReserveDraft {
  return {
    reason: (c.reserveReason as string) || '',
    desiredCity: c.reserveDesiredCity || '',
    priceMin: c.reservePriceMin != null ? String(c.reservePriceMin) : '',
    priceMax: c.reservePriceMax != null ? String(c.reservePriceMax) : '',
    propertyType: c.reservePropertyType || '',
    bedrooms: c.reserveBedrooms != null ? String(c.reserveBedrooms) : '',
    interestType: c.reserveInterestType || '',
    followUpMoment: c.reserveFollowUpMoment || '',
    commercialNotes: c.reserveCommercialNotes || '',
  };
}

function draftToPatch(d: ReserveDraft): ReserveSegmentationPatchBody {
  const nMin = d.priceMin.trim() === '' ? null : Number(d.priceMin.replace(',', '.'));
  const nMax = d.priceMax.trim() === '' ? null : Number(d.priceMax.replace(',', '.'));
  const nBed = d.bedrooms.trim() === '' ? null : Math.round(Number(d.bedrooms));
  return {
    reason: d.reason ? (d.reason as ReserveReason) : null,
    desiredCity: d.desiredCity.trim() || null,
    desiredPriceMin: nMin != null && Number.isFinite(nMin) ? nMin : null,
    desiredPriceMax: nMax != null && Number.isFinite(nMax) ? nMax : null,
    propertyType: d.propertyType.trim() || null,
    bedrooms: nBed != null && Number.isFinite(nBed) ? nBed : null,
    interestType: d.interestType ? (d.interestType as ReserveInterestType) : null,
    followUpMoment: d.followUpMoment.trim() || null,
    commercialNotes: d.commercialNotes.trim() || null,
  };
}

function getStoredDetailsOpen(): boolean {
  try {
    const raw = localStorage.getItem(DETAILS_PANEL_KEY);
    if (raw == null) return true;
    return raw === '1';
  } catch {
    return true;
  }
}

function displayOrFallback(value: string | null | undefined): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : 'Nao informado';
}

export interface ChatPanelProps {
  conversation: Conversation | null;
  windowStatus?: Conversation['whatsappWindow'] | null;
  sendError?: string | null;
  messages: Message[];
  isLoadingMessages: boolean;
  loadError: string | null;
  onSendMessage: (text: string, file?: File | null) => void;
  onClassificationChange?: (updates: {
    projectId?: number | null;
    classificationStatus?: string;
    handoff?: boolean;
    leadTemperature?: 'quente' | 'morno' | 'frio';
    reserve?: ReserveSegmentationPatchBody;
    assignedBrokerId?: number | null;
  }) => void | Promise<void>;
  onConversationTypeChange?: (type: 'CLIENT' | 'INTERNAL') => void | Promise<void>;
  onResetConversation?: (conversationId: string) => void | Promise<void>;
  onCloseConversation?: () => void | Promise<void>;
  onReopenConversation?: () => void | Promise<void>;
  onDeleteMessage?: (messageId: string) => void | Promise<void>;
  onUpdateCustomerName?: (name: string | null) => Promise<void>;
  projects?: { id: number; name: string; active: boolean }[];
  isSending?: boolean;
  onScrollContainerRef?: (el: HTMLDivElement | null) => void;
  showNewMessageIndicator?: boolean;
  onJumpToLatest?: () => void;
}

export function ChatPanel({
  conversation,
  windowStatus = null,
  sendError = null,
  messages,
  isLoadingMessages,
  loadError,
  onSendMessage,
  onClassificationChange,
  onConversationTypeChange,
  onResetConversation,
  onCloseConversation,
  onReopenConversation,
  onDeleteMessage,
  onUpdateCustomerName,
  projects = [],
  isSending = false,
  onScrollContainerRef,
  showNewMessageIndicator = false,
  onJumpToLatest,
}: ChatPanelProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [reserveDraft, setReserveDraft] = useState<ReserveDraft | null>(null);
  const [reserveSaving, setReserveSaving] = useState(false);
  const [reserveErr, setReserveErr] = useState<string | null>(null);
  const [brokersForProject, setBrokersForProject] = useState<{ id: number; fullName: string }[]>([]);
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [nameSaving, setNameSaving] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState<boolean>(() => getStoredDetailsOpen());
  const [typeSaving, setTypeSaving] = useState(false);
  const [typeFeedback, setTypeFeedback] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(DETAILS_PANEL_KEY, detailsOpen ? '1' : '0');
    } catch {
      // noop
    }
  }, [detailsOpen]);

  const setRef = useCallback(
    (el: HTMLDivElement | null) => {
      (scrollContainerRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
      onScrollContainerRef?.(el);
    },
    [onScrollContainerRef]
  );

  useEffect(() => {
    if (!conversation) {
      setReserveDraft(null);
      return;
    }
    setReserveDraft(conversationToDraft(conversation));
    setReserveErr(null);
  }, [conversation?.id ?? '', conversation ? reserveFingerprint(conversation) : '']);

  useEffect(() => {
    if (!conversation) {
      setBrokersForProject([]);
      return;
    }
    const pid = conversation.projectId;
    const params = pid != null ? { enterpriseId: pid } : undefined;
    corretoresApi
      .list(params)
      .then((d) => setBrokersForProject(d.corretores.map((c) => ({ id: c.id, fullName: c.fullName }))))
      .catch(() => setBrokersForProject([]));
  }, [conversation?.id, conversation?.projectId]);

  if (!conversation) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-[#f7f9fc] text-[#64748b] p-8">
        <div className="w-14 h-14 rounded-full bg-[#EFF6FF] flex items-center justify-center mb-4">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        </div>
        <p className="text-[15px] font-medium text-[#111827] mb-1">Selecione uma conversa</p>
        <p className="text-[13px] text-[#9CA3AF]">Escolha uma conversa na lista a esquerda para comecar.</p>
      </div>
    );
  }

  const displayName =
    (conversation.confirmedCustomerName ?? '').trim() ||
    (conversation.leadName ?? '').trim() ||
    conversation.leadPhone.trim() ||
    'Lead';

  const handleStartEditName = () => {
    setNameInput((conversation.confirmedCustomerName ?? '').trim());
    setNameError(null);
    setIsEditingName(true);
  };

  const handleCancelEditName = () => {
    setIsEditingName(false);
    setNameError(null);
  };

  const handleSaveName = async () => {
    if (!onUpdateCustomerName || nameSaving) return;
    setNameSaving(true);
    setNameError(null);
    try {
      const value = nameInput.trim() || null;
      await onUpdateCustomerName(value);
      setIsEditingName(false);
    } catch {
      setNameError('Erro ao salvar. Tente novamente.');
    } finally {
      setNameSaving(false);
    }
  };

  const cls = conversation.classificationStatus ?? conversation.status ?? 'Novo';
  const statusLabel = (conversation.classificationStatus ?? '').trim() || formatStatus(conversation.status);
  const showCarteiraBlock = cls === 'Carteira' && !conversation.handoff;
  const d = reserveDraft;

  const hasReserveData =
    !!conversation.reserveReason ||
    !!conversation.reserveDesiredCity ||
    conversation.reservePriceMin != null ||
    conversation.reservePriceMax != null ||
    !!conversation.reservePropertyType ||
    conversation.reserveBedrooms != null ||
    !!conversation.reserveInterestType ||
    !!conversation.reserveFollowUpMoment ||
    !!conversation.reserveCommercialNotes;

  const saveReserve = async () => {
    if (!onClassificationChange || !d) return;
    setReserveSaving(true);
    setReserveErr(null);
    try {
      await Promise.resolve(onClassificationChange({ reserve: draftToPatch(d) }));
    } catch (e) {
      setReserveErr(e instanceof Error ? e.message : 'Erro ao salvar segmentacao');
    } finally {
      setReserveSaving(false);
    }
  };

  let lastDate = '';

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[rgba(255,255,255,0.92)]">
      <header className="shrink-0 border-b border-[#e2e8f0] bg-[rgba(255,255,255,0.94)] px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex items-start gap-3">
            <div className="min-w-0">
              {!isEditingName ? (
                <div className="flex items-center gap-1.5 min-w-0">
                  <h3 className="text-[15px] font-semibold text-[#111827] truncate leading-tight">{displayName}</h3>
                  {onUpdateCustomerName && (
                    <button
                      type="button"
                      onClick={handleStartEditName}
                      className="shrink-0 text-[#CBD5E1] hover:text-[#3B82F6] transition-colors"
                      title="Editar nome do contato"
                      aria-label="Editar nome do contato"
                    >
                      <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5" aria-hidden>
                        <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                      </svg>
                    </button>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveName();
                      if (e.key === 'Escape') handleCancelEditName();
                    }}
                    maxLength={80}
                    placeholder="Nome do contato"
                    autoFocus
                    disabled={nameSaving}
                    className="text-[14px] font-semibold text-[#111827] border border-[#3B82F6] rounded-lg px-2 py-0.5 outline-none focus:ring-2 focus:ring-[rgba(59,130,246,0.2)] w-44 disabled:opacity-60"
                  />
                  <button
                    type="button"
                    onClick={handleSaveName}
                    disabled={nameSaving}
                    className="shrink-0 text-[#3B82F6] hover:text-[#2563EB] disabled:opacity-50 transition-colors"
                    title="Salvar"
                    aria-label="Salvar nome"
                  >
                    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4" aria-hidden>
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={handleCancelEditName}
                    disabled={nameSaving}
                    className="shrink-0 text-[#9CA3AF] hover:text-[#374151] disabled:opacity-50 transition-colors"
                    title="Cancelar"
                    aria-label="Cancelar edicao"
                  >
                    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4" aria-hidden>
                      <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                  </button>
                </div>
              )}
              {nameError && <p className="text-[11px] text-[#EF4444] mt-0.5">{nameError}</p>}
              <div className="mt-0.5 flex items-center gap-2 flex-wrap">
                <p className="text-[13px] text-[#6B7280] truncate">{conversation.leadPhone || 'Sem telefone'}</p>
                {(conversation.projectName || conversation.empreendimento) && (
                  <span className="inline-flex items-center text-[11px] font-semibold px-2 py-[3px] rounded-[6px] bg-[#EFF6FF] text-[#1d4ed8]">
                    {conversation.projectName || conversation.empreendimento}
                  </span>
                )}
                <span className="text-[11px] font-medium px-2 py-[3px] rounded-[6px] bg-[#F3F4F6] text-[#6B7280]">
                  {formatStatus(conversation.status)}
                </span>
                <span title={`Lead ${conversation.temperatura ?? 'nao definida'}`} className="inline-flex items-center p-0.5">
                  <FlameIcon temperatura={conversation.temperatura} size="sm" />
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {onResetConversation && (
              <button
                type="button"
                onClick={() => onResetConversation(conversation.id)}
                title="Limpa dados comerciais e operacionais; as mensagens permanecem no historico"
                className="inline-flex items-center gap-1 text-[11px] font-medium text-[#6B7280] border border-[#E5E7EB] hover:text-amber-700 hover:border-amber-200 hover:bg-amber-50 rounded-[8px] px-2.5 py-1 transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
                Resetar
              </button>
            )}
            <button
              type="button"
              onClick={() => setDetailsOpen((prev) => !prev)}
              className={`inline-flex items-center gap-1.5 rounded-[10px] border px-3 py-1.5 text-[12px] font-semibold transition-colors ${detailsOpen ? 'border-[#fdba74] bg-[#fff7ed] text-[#c2410c]' : 'border-[#cbd5e1] bg-white text-[#334155] hover:border-[#93c5fd] hover:bg-[#eaf2ff] hover:text-[#123a73]'}`}
              aria-label={detailsOpen ? 'Ocultar detalhes da conversa' : 'Mostrar detalhes da conversa'}
              title={detailsOpen ? 'Ocultar detalhes' : 'Mostrar detalhes'}
            >
              Detalhes
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {detailsOpen ? <path d="M18 15l-6-6-6 6" /> : <path d="M6 9l6 6 6-6" />}
              </svg>
            </button>
          </div>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        <section className={`flex min-w-0 flex-1 flex-col ${detailsOpen ? 'border-r border-[#e2e8f0]' : ''}`}>
          <div className="relative flex-1 min-h-0">
            <div ref={setRef} className="h-full overflow-y-auto bg-[#f7f9fc] px-5 pb-1 pt-5">
              <div className="min-h-full flex flex-col">
                {loadError ? (
                  <div className="flex-1 flex flex-col items-center justify-center py-12 text-center">
                    <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center mb-3">
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                    </div>
                    <p className="text-[13px] text-red-600">Falha ao carregar mensagens</p>
                  </div>
                ) : isLoadingMessages ? (
                  <div className="flex-1 flex flex-col items-center justify-center py-12 gap-3">
                    <div className="h-5 w-5 rounded-full border-2 border-[#3B82F6] border-t-transparent animate-spin" />
                    <span className="text-[13px] text-[#6B7280]">Carregando...</span>
                  </div>
                ) : messages.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center py-12 text-center">
                    <p className="text-[13px] text-[#9CA3AF]">Sem mensagens ainda</p>
                  </div>
                ) : (
                  <div className="mt-auto">
                    {messages.map((msg, idx) => {
                      const dateLabel = formatDateSeparator(msg.createdAt);
                      const showDate = dateLabel !== lastDate;
                      if (showDate) lastDate = dateLabel;
                      const isLast = idx === messages.length - 1;
                      return (
                        <div key={msg.id}>
                          {showDate && (
                            <div className="my-4 flex justify-center">
                              <span className="rounded-full border border-[#e2e8f0] bg-white/85 px-3 py-1 text-[11px] font-semibold text-[#64748b]">
                                {dateLabel}
                              </span>
                            </div>
                          )}
                          <MessageBubble message={msg} onDeleteMessage={onDeleteMessage} isLast={isLast} />
                        </div>
                      );
                    })}
                    <div ref={messagesEndRef} />
                  </div>
                )}
              </div>
            </div>
            {showNewMessageIndicator && (
              <button
                type="button"
                onClick={onJumpToLatest}
                className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-[#bfdbfe] bg-white px-3 py-1 text-[11px] font-medium text-[#1d4ed8] shadow-sm hover:bg-[#eff6ff]"
              >
                Nova mensagem
              </button>
            )}
          </div>

          {!loadError && (
            <>
              {sendError && (
                <div className="border-t border-[#fecaca] bg-[#fef2f2] px-4 py-2 text-[12px] text-[#b91c1c]">{sendError}</div>
              )}
              <ChatComposer
                onSend={onSendMessage}
                disabled={isLoadingMessages || isSending || (windowStatus ? !windowStatus.isOpen : false)}
                placeholder={
                  isLoadingMessages
                    ? 'Carregando historico...'
                    : windowStatus && !windowStatus.isOpen
                    ? 'Envio de texto livre bloqueado fora da janela de 24h.'
                    : 'Digite sua mensagem...'
                }
              />
            </>
          )}
        </section>

        {detailsOpen && (
          <>
            <button
              type="button"
              className="absolute inset-0 z-10 bg-black/20 md:hidden"
              onClick={() => setDetailsOpen(false)}
              aria-label="Fechar detalhes"
            />
            <aside className="absolute inset-y-0 right-0 z-20 w-[86%] max-w-[336px] overflow-y-auto border-l border-[#e2e8f0] bg-[#fbfdff] shadow-[-12px_0_30px_rgba(15,23,42,0.16)] md:static md:w-[336px] md:max-w-none md:shrink-0 md:border-l-0 md:shadow-none">
              <div className="space-y-4 p-4">
              <section className="rounded-[12px] border border-[#e2e8f0] bg-white p-3">
                <h4 className="text-[12px] font-semibold uppercase tracking-wide text-[#334155]">Resumo operacional</h4>
                <dl className="mt-2 grid gap-2 text-[12px] text-[#334155]">
                  <div className="flex items-start justify-between gap-2">
                    <dt className="text-[#94a3b8]">Modo</dt>
                    <dd className="font-medium">{conversation.handoff ? 'Handoff' : 'ANA'}</dd>
                  </div>
                  <div className="flex items-start justify-between gap-2">
                    <dt className="text-[#94a3b8]">Empreendimento</dt>
                    <dd className="max-w-[190px] text-right font-medium">{displayOrFallback(conversation.projectName || conversation.empreendimento)}</dd>
                  </div>
                  <div className="flex items-start justify-between gap-2">
                    <dt className="text-[#94a3b8]">Corretor</dt>
                    <dd className="max-w-[190px] text-right font-medium">{displayOrFallback(conversation.assignedBrokerName)}</dd>
                  </div>
                  <div className="flex items-start justify-between gap-2">
                    <dt className="text-[#94a3b8]">Status</dt>
                    <dd className="font-medium">{statusLabel}</dd>
                  </div>
                  <div className="flex items-start justify-between gap-2">
                    <dt className="text-[#94a3b8]">Temperatura</dt>
                    <dd className="font-medium">{displayOrFallback(conversation.temperatura)}</dd>
                  </div>
                </dl>
              </section>

              {onClassificationChange && (
                <section className="rounded-[12px] border border-[#e2e8f0] bg-white p-3 space-y-3">
                  <h4 className="text-[12px] font-semibold uppercase tracking-wide text-[#334155]">Controles</h4>

                  <div className="space-y-1">
                    <span className={labelSm}>Modo de atendimento</span>
                    <div role="group" aria-label="Modo da conversa" className="inline-flex p-0.5 rounded-[10px] bg-[#F3F4F6] border border-[#E5E7EB]">
                      <button
                        type="button"
                        onClick={() => onClassificationChange({ handoff: false })}
                        title="ANA: resposta automatica da ANA"
                        className={`px-3 py-1.5 rounded-[8px] text-[12px] font-medium transition-all ${
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
                        className={`px-3 py-1.5 rounded-[8px] text-[12px] font-medium transition-all ${
                          conversation.handoff
                            ? 'bg-[#F97316] text-white shadow-sm'
                            : 'text-[#6B7280] hover:text-[#111827] hover:bg-[#E5E7EB]/60'
                        }`}
                      >
                        Handoff
                      </button>
                    </div>
                  </div>

                  {onConversationTypeChange && (
                    <label className="block">
                      <span className={labelSm}>Tipo da conversa</span>
                      <select
                        aria-label="Tipo da conversa"
                        disabled={typeSaving}
                        value={
                          conversation.conversationType === 'ADMIN' || conversation.conversationType === 'CORRETOR'
                            ? 'INTERNAL'
                            : 'CLIENT'
                        }
                        onChange={async (e) => {
                          const nextType = e.target.value === 'INTERNAL' ? 'INTERNAL' : 'CLIENT';
                          setTypeSaving(true);
                          setTypeFeedback(null);
                          try {
                            await Promise.resolve(onConversationTypeChange(nextType));
                            setTypeFeedback('Tipo da conversa atualizado.');
                          } catch (error) {
                            setTypeFeedback(error instanceof Error ? error.message : 'Falha ao atualizar tipo.');
                          } finally {
                            setTypeSaving(false);
                          }
                        }}
                        className={`${selectField} w-full`}
                      >
                        <option value="CLIENT">Cliente</option>
                        <option value="INTERNAL">Interno</option>
                      </select>
                      {typeFeedback && (
                        <p className="mt-1 text-[11px] text-[#64748b]">{typeFeedback}</p>
                      )}
                    </label>
                  )}

                  <label className="block">
                    <span className={labelSm}>Temperatura</span>
                    <select
                      aria-label="Temperatura do lead"
                      value={conversation.temperatura ?? ''}
                      onChange={(e) => {
                        const raw = e.target.value;
                        if (raw !== 'frio' && raw !== 'morno' && raw !== 'quente') return;
                        onClassificationChange({ leadTemperature: raw });
                      }}
                      className={`${selectField} w-full`}
                    >
                      <option value="" disabled>
                        Selecionar temperatura
                      </option>
                      <option value="frio">Frio</option>
                      <option value="morno">Morno</option>
                      <option value="quente">Quente</option>
                    </select>
                  </label>

                  <label className="block">
                    <span className={labelSm}>Projeto</span>
                    <select
                      value={conversation.projectId ?? ''}
                      onChange={(e) => {
                        const v = e.target.value;
                        onClassificationChange({ projectId: v === '' ? null : Number(v) });
                      }}
                      className={`${selectField} w-full`}
                    >
                      <option value="">- Empreendimento</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block">
                    <span className={labelSm}>Corretor</span>
                    <select
                      aria-label="Corretor fixo do lead"
                      value={conversation.assignedBrokerId ?? ''}
                      onChange={(e) => {
                        const v = e.target.value;
                        onClassificationChange({ assignedBrokerId: v === '' ? null : Number(v) });
                      }}
                      className={`${selectField} w-full`}
                    >
                      <option value="">Automatico</option>
                      {brokersForProject.length === 0 && (
                        <option value="" disabled>
                          Nenhum corretor disponivel
                        </option>
                      )}
                      {brokersForProject.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.fullName}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block">
                    <span className={labelSm}>Status / funil</span>
                    <select
                      value={conversation.classificationStatus ?? conversation.status ?? 'Novo'}
                      onChange={(e) => {
                        onClassificationChange({ classificationStatus: e.target.value });
                      }}
                      className={`${selectField} w-full`}
                    >
                      {STATUS_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <p className="text-[11px] text-[#9CA3AF] leading-snug">
                    Com empreendimento e temperatura definidos, o funil deixa de ser "Novo" e vai para "Qualificado".
                    Handoff e Carteira nao sao alterados automaticamente.
                  </p>
                </section>
              )}

              {showCarteiraBlock && d && (
                <section className="rounded-[12px] border border-[#EDE9FE] bg-[#FAF5FF]/80 p-3 space-y-3">
                  <h4 className="text-[12px] font-semibold uppercase tracking-wide text-[#5B21B6]">Carteira</h4>
                  <p className="text-[11px] text-[#6B7280] leading-relaxed">
                    Dados para retomada e campanhas futuras. Preenchimento parcial permitido.
                  </p>

                  {hasReserveData && (
                    <dl className="grid gap-1.5 text-[12px] text-[#374151] border-t border-[#EDE9FE] pt-3">
                      {conversation.reserveReason && (
                        <div className="flex gap-2">
                          <dt className="text-[#9CA3AF] shrink-0">Motivo</dt>
                          <dd>{RESERVE_REASON_LABELS[conversation.reserveReason as ReserveReason] ?? conversation.reserveReason}</dd>
                        </div>
                      )}
                      {conversation.reserveDesiredCity && (
                        <div className="flex gap-2">
                          <dt className="text-[#9CA3AF] shrink-0">Cidade</dt>
                          <dd>{conversation.reserveDesiredCity}</dd>
                        </div>
                      )}
                      {(conversation.reservePriceMin != null || conversation.reservePriceMax != null) && (
                        <div className="flex gap-2">
                          <dt className="text-[#9CA3AF] shrink-0">Faixa</dt>
                          <dd>{formatBrlRange(conversation.reservePriceMin, conversation.reservePriceMax)}</dd>
                        </div>
                      )}
                    </dl>
                  )}

                  <div className="grid gap-3 border-t border-[#EDE9FE] pt-3">
                    <label>
                      <span className={labelSm}>Motivo (Carteira)</span>
                      <select className={`${selectField} w-full`} value={d.reason} onChange={(e) => setReserveDraft({ ...d, reason: e.target.value })}>
                        <option value="">- Selecionar -</option>
                        {RESERVE_REASONS.map((r) => (
                          <option key={r} value={r}>{RESERVE_REASON_LABELS[r]}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span className={labelSm}>Cidade desejada</span>
                      <input className={inputField} value={d.desiredCity} onChange={(e) => setReserveDraft({ ...d, desiredCity: e.target.value })} placeholder="Ex.: Jacarei" />
                    </label>
                    <label>
                      <span className={labelSm}>Finalidade / interesse</span>
                      <select className={`${selectField} w-full`} value={d.interestType} onChange={(e) => setReserveDraft({ ...d, interestType: e.target.value })}>
                        <option value="">-</option>
                        {RESERVE_INTEREST_TYPES.map((t) => (
                          <option key={t} value={t}>{RESERVE_INTEREST_LABELS[t]}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span className={labelSm}>Valor minimo (R$)</span>
                      <input className={inputField} inputMode="decimal" value={d.priceMin} onChange={(e) => setReserveDraft({ ...d, priceMin: e.target.value })} />
                    </label>
                    <label>
                      <span className={labelSm}>Valor maximo (R$)</span>
                      <input className={inputField} inputMode="decimal" value={d.priceMax} onChange={(e) => setReserveDraft({ ...d, priceMax: e.target.value })} />
                    </label>
                    <label>
                      <span className={labelSm}>Tipo de imovel</span>
                      <input className={inputField} value={d.propertyType} onChange={(e) => setReserveDraft({ ...d, propertyType: e.target.value })} />
                    </label>
                    <label>
                      <span className={labelSm}>Quartos</span>
                      <input className={inputField} inputMode="numeric" value={d.bedrooms} onChange={(e) => setReserveDraft({ ...d, bedrooms: e.target.value })} />
                    </label>
                    <label>
                      <span className={labelSm}>Melhor momento para retomar</span>
                      <input className={inputField} value={d.followUpMoment} onChange={(e) => setReserveDraft({ ...d, followUpMoment: e.target.value })} />
                    </label>
                    <label>
                      <span className={labelSm}>Observacoes comerciais</span>
                      <textarea className={`${inputField} min-h-[72px] resize-y`} value={d.commercialNotes} onChange={(e) => setReserveDraft({ ...d, commercialNotes: e.target.value })} />
                    </label>
                  </div>
                  {reserveErr && <p className="text-[12px] text-red-600">{reserveErr}</p>}
                  <button
                    type="button"
                    onClick={() => void saveReserve()}
                    disabled={reserveSaving}
                    className="inline-flex items-center justify-center gap-2 text-[13px] font-semibold bg-[#7C3AED] text-white rounded-[8px] px-4 py-2 hover:bg-[#6D28D9] disabled:opacity-50 transition-colors"
                  >
                    {reserveSaving ? (
                      <>
                        <span className="h-3.5 w-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                        Salvando...
                      </>
                    ) : (
                      'Salvar segmentacao'
                    )}
                  </button>
                </section>
              )}

              {windowStatus && (
                <section className="rounded-[12px] border border-[#E5E7EB] bg-white p-3">
                  <span
                    className={`inline-flex items-center text-[11px] font-semibold px-2.5 py-1 rounded-[6px] ${
                      windowStatus.isOpen
                        ? 'bg-[#ECFDF5] text-[#047857] border border-[#A7F3D0]'
                        : 'bg-[#FEF2F2] text-[#B91C1C] border border-[#FECACA]'
                    }`}
                  >
                    {windowStatus.isOpen ? 'Janela aberta' : 'Fora da janela de 24h'}
                  </span>
                  {!windowStatus.isOpen && (
                    <p className="mt-2 text-[12px] text-[#B91C1C]">
                      Este contato nao interagiu nas ultimas 24 horas. Para iniciar contato, use uma mensagem padrao/template.
                    </p>
                  )}
                </section>
              )}

              {(onCloseConversation || onReopenConversation) && (
                <section className="rounded-[12px] border border-[#E5E7EB] bg-white p-3 space-y-2">
                  <h4 className="text-[12px] font-semibold uppercase tracking-wide text-[#334155]">Conversa</h4>
                  {conversation.manualClosedAt ? (
                    <button
                      type="button"
                      onClick={() => void onReopenConversation?.()}
                      className="w-full rounded-[8px] border border-[#A7F3D0] bg-[#ECFDF5] px-3 py-2 text-[12px] font-semibold text-[#047857] hover:bg-[#dcfce7]"
                    >
                      Reabrir conversa
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void onCloseConversation?.()}
                      className="w-full rounded-[8px] border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-[12px] font-semibold text-[#B91C1C] hover:bg-[#fee2e2]"
                    >
                      Encerrar conversa
                    </button>
                  )}
                </section>
              )}
              </div>
            </aside>
          </>
        )}
      </div>
    </div>
  );
}
