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

interface ChatPanelProps {
  conversation: Conversation | null;
  messages: Message[];
  isLoadingMessages: boolean;
  loadError: string | null;
  onSendMessage: (text: string) => void;
  onClassificationChange?: (updates: {
    projectId?: number | null;
    classificationStatus?: string;
    handoff?: boolean;
    leadTemperature?: 'quente' | 'morno' | 'frio';
    reserve?: ReserveSegmentationPatchBody;
    assignedBrokerId?: number | null;
  }) => void | Promise<void>;
  projects?: { id: number; name: string; active: boolean }[];
  isSending?: boolean;
  onScrollContainerRef?: (el: HTMLDivElement | null) => void;
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
  onScrollContainerRef,
}: ChatPanelProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [reserveDraft, setReserveDraft] = useState<ReserveDraft | null>(null);
  const [reserveSaving, setReserveSaving] = useState(false);
  const [reserveErr, setReserveErr] = useState<string | null>(null);
  const [brokersForProject, setBrokersForProject] = useState<{ id: number; fullName: string }[]>([]);

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
    const pid = conversation?.projectId;
    if (pid == null) {
      setBrokersForProject([]);
      return;
    }
    corretoresApi
      .list({ enterpriseId: pid })
      .then((d) => setBrokersForProject(d.corretores.map((c) => ({ id: c.id, fullName: c.fullName }))))
      .catch(() => setBrokersForProject([]));
  }, [conversation?.id, conversation?.projectId]);

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
  const cls = conversation.classificationStatus ?? conversation.status ?? 'Novo';
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
      setReserveErr(e instanceof Error ? e.message : 'Erro ao salvar segmentação');
    } finally {
      setReserveSaving(false);
    }
  };

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
            {conversation.enterpriseOriginId != null &&
              conversation.enterpriseOriginId !== (conversation.projectId ?? null) && (
                <span
                  className="inline-flex items-center text-[10px] font-medium px-2 py-[3px] rounded-[6px] bg-[#F9FAFB] text-[#6B7280] border border-[#E8ECF1]"
                  title="Empreendimento da campanha de origem (histórico; o ativo pode ter sido alterado)"
                >
                  Origem: {conversation.enterpriseOriginName ?? `empreendimento #${conversation.enterpriseOriginId}`}
                </span>
              )}
            {conversation.handoff && conversation.assignedBrokerName?.trim() && (
              <span className="inline-flex items-center text-[11px] font-semibold px-2.5 py-1 rounded-[6px] bg-[#ECFDF5] text-[#047857] border border-[#A7F3D0] max-w-[180px] truncate">
                {conversation.assignedBrokerName}
              </span>
            )}
            {onClassificationChange ? (
              <label className="inline-flex items-center gap-1.5">
                <span
                  title={
                    conversation.temperatura
                      ? `Temperatura: ${conversation.temperatura}`
                      : 'Temperatura ainda não definida — escolha Frio, Morno ou Quente (definição é permanente)'
                  }
                  className="inline-flex items-center p-0.5"
                >
                  <FlameIcon temperatura={conversation.temperatura} size="md" />
                </span>
                <select
                  aria-label="Temperatura do lead"
                  value={conversation.temperatura ?? ''}
                  onChange={(e) => {
                    const raw = e.target.value;
                    if (raw !== 'frio' && raw !== 'morno' && raw !== 'quente') return;
                    onClassificationChange({ leadTemperature: raw });
                  }}
                  className={selectField}
                >
                  <option value="" disabled>
                    Selecionar temperatura
                  </option>
                  <option value="frio">Frio</option>
                  <option value="morno">Morno</option>
                  <option value="quente">Quente</option>
                </select>
              </label>
            ) : (
              <span
                title={`Lead ${conversation.temperatura ?? 'não definida'}`}
                className="inline-flex items-center p-1"
              >
                <FlameIcon temperatura={conversation.temperatura} size="md" />
              </span>
            )}
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
              <span className="text-[13px] text-[#6B7280]">Corretor:</span>
              <select
                aria-label="Corretor fixo do lead"
                value={conversation.assignedBrokerId ?? ''}
                onChange={(e) => {
                  const v = e.target.value;
                  onClassificationChange({
                    assignedBrokerId: v === '' ? null : Number(v),
                  });
                }}
                className={selectField}
                disabled={!conversation.projectId}
                title={
                  conversation.projectId
                    ? 'Prioridade: manual > já atribuído > automático. Vazio = distribuição automática.'
                    : 'Defina um empreendimento para listar corretores.'
                }
              >
                <option value="">Automático</option>
                {brokersForProject.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.fullName}
                  </option>
                ))}
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
            <p className="w-full text-[11px] text-[#9CA3AF] leading-snug">
              Com <strong className="text-[#6B7280] font-medium">empreendimento</strong> e{' '}
              <strong className="text-[#6B7280] font-medium">temperatura</strong> escolhida (Frio, Morno ou Quente), o funil deixa de ser
              &quot;Novo&quot; e passa para &quot;Qualificado&quot;. A primeira temperatura definida não pode ser removida depois. Handoff e Carteira
              não são alterados automaticamente.
            </p>
          </div>
        )}

        {showCarteiraBlock && d && (
          <div className="mt-4 rounded-[10px] border border-[#EDE9FE] bg-[#FAF5FF]/80 px-4 py-3 space-y-3">
            <p className="text-[12px] font-semibold text-[#5B21B6] uppercase tracking-wide">Carteira — segmentação comercial</p>
            <p className="text-[11px] text-[#6B7280] leading-relaxed">
              Dados para retomada e campanhas futuras. Preenchimento parcial permitido. Salve com o botão abaixo.
            </p>

            {hasReserveData && (
              <dl className="grid gap-1.5 text-[12px] text-[#374151] border-t border-[#EDE9FE] pt-3">
                <div className="flex gap-2">
                  <dt className="text-[#9CA3AF] shrink-0">Classificação</dt>
                  <dd className="font-medium">Carteira</dd>
                </div>
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
                {conversation.reservePropertyType && (
                  <div className="flex gap-2">
                    <dt className="text-[#9CA3AF] shrink-0">Tipo</dt>
                    <dd>{conversation.reservePropertyType}</dd>
                  </div>
                )}
                {conversation.reserveBedrooms != null && (
                  <div className="flex gap-2">
                    <dt className="text-[#9CA3AF] shrink-0">Quartos</dt>
                    <dd>{conversation.reserveBedrooms}</dd>
                  </div>
                )}
                {conversation.reserveInterestType && (
                  <div className="flex gap-2">
                    <dt className="text-[#9CA3AF] shrink-0">Finalidade</dt>
                    <dd>{RESERVE_INTEREST_LABELS[conversation.reserveInterestType as ReserveInterestType] ?? conversation.reserveInterestType}</dd>
                  </div>
                )}
                {conversation.reserveFollowUpMoment && (
                  <div className="flex gap-2">
                    <dt className="text-[#9CA3AF] shrink-0">Retomar</dt>
                    <dd>{conversation.reserveFollowUpMoment}</dd>
                  </div>
                )}
                {conversation.reserveCommercialNotes && (
                  <div className="flex flex-col gap-0.5">
                    <dt className="text-[#9CA3AF]">Observações</dt>
                    <dd className="text-[#111827] whitespace-pre-wrap">{conversation.reserveCommercialNotes}</dd>
                  </div>
                )}
              </dl>
            )}

            <div className="grid sm:grid-cols-2 gap-3 border-t border-[#EDE9FE] pt-3">
              <label className="sm:col-span-2">
                <span className={labelSm}>Motivo (Carteira)</span>
                <select
                  className={`${selectField} w-full`}
                  value={d.reason}
                  onChange={(e) => setReserveDraft({ ...d, reason: e.target.value })}
                >
                  <option value="">— Selecionar —</option>
                  {RESERVE_REASONS.map((r) => (
                    <option key={r} value={r}>{RESERVE_REASON_LABELS[r]}</option>
                  ))}
                </select>
              </label>
              <label>
                <span className={labelSm}>Cidade desejada</span>
                <input
                  className={inputField}
                  value={d.desiredCity}
                  onChange={(e) => setReserveDraft({ ...d, desiredCity: e.target.value })}
                  placeholder="Ex.: Jacareí"
                />
              </label>
              <label>
                <span className={labelSm}>Finalidade / interesse</span>
                <select
                  className={`${selectField} w-full`}
                  value={d.interestType}
                  onChange={(e) => setReserveDraft({ ...d, interestType: e.target.value })}
                >
                  <option value="">—</option>
                  {RESERVE_INTEREST_TYPES.map((t) => (
                    <option key={t} value={t}>{RESERVE_INTEREST_LABELS[t]}</option>
                  ))}
                </select>
              </label>
              <label>
                <span className={labelSm}>Valor mínimo (R$)</span>
                <input
                  className={inputField}
                  inputMode="decimal"
                  value={d.priceMin}
                  onChange={(e) => setReserveDraft({ ...d, priceMin: e.target.value })}
                  placeholder="300000"
                />
              </label>
              <label>
                <span className={labelSm}>Valor máximo (R$)</span>
                <input
                  className={inputField}
                  inputMode="decimal"
                  value={d.priceMax}
                  onChange={(e) => setReserveDraft({ ...d, priceMax: e.target.value })}
                  placeholder="450000"
                />
              </label>
              <label>
                <span className={labelSm}>Tipo de imóvel</span>
                <input
                  className={inputField}
                  value={d.propertyType}
                  onChange={(e) => setReserveDraft({ ...d, propertyType: e.target.value })}
                  placeholder="Apartamento, casa…"
                />
              </label>
              <label>
                <span className={labelSm}>Quartos</span>
                <input
                  className={inputField}
                  inputMode="numeric"
                  value={d.bedrooms}
                  onChange={(e) => setReserveDraft({ ...d, bedrooms: e.target.value })}
                  placeholder="2"
                />
              </label>
              <label className="sm:col-span-2">
                <span className={labelSm}>Melhor momento para retomar</span>
                <input
                  className={inputField}
                  value={d.followUpMoment}
                  onChange={(e) => setReserveDraft({ ...d, followUpMoment: e.target.value })}
                  placeholder="Ex.: em 3 meses, após 13º…"
                />
              </label>
              <label className="sm:col-span-2">
                <span className={labelSm}>Observações comerciais</span>
                <textarea
                  className={`${inputField} min-h-[72px] resize-y`}
                  value={d.commercialNotes}
                  onChange={(e) => setReserveDraft({ ...d, commercialNotes: e.target.value })}
                  placeholder="Notas para reativação ou campanhas futuras"
                />
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
                  Salvando…
                </>
              ) : (
                'Salvar segmentação'
              )}
            </button>
          </div>
        )}
      </header>

      <div ref={setRef} className="flex-1 overflow-y-auto min-h-0 p-4 bg-[#F9FAFB]">
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
