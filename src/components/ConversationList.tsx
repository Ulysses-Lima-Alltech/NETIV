import { useLayoutEffect, useMemo, useRef } from 'react';
import type { Conversation } from '../types';
import { ConversationListItem } from './ConversationListItem';

interface ConversationListProps {
  conversations: Conversation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDelete?: (id: string) => void;
  onNewMessage?: () => void;
  isLoading?: boolean;
  compact?: boolean;
  onToggleCollapsed?: () => void;
  onScrollMetaChange?: (meta: { scrollTop: number; nearTop: boolean }) => void;
  hasPendingRealtimeUpdates?: boolean;
  onApplyRealtimeUpdates?: () => void;
}

export function ConversationList({
  conversations,
  selectedId,
  onSelect,
  onDelete,
  onNewMessage,
  isLoading = false,
  compact = false,
  onToggleCollapsed,
  onScrollMetaChange,
  hasPendingRealtimeUpdates = false,
  onApplyRealtimeUpdates,
}: ConversationListProps) {
  const scrollElRef = useRef<HTMLDivElement | null>(null);
  const scrollTopRef = useRef(0);
  const hasHydratedScrollRef = useRef(false);
  const hasUserScrolledRef = useRef(false);
  const listSignature = useMemo(() => conversations.map((c) => c.id).join('|'), [conversations]);
  const SCROLL_KEY = 'netiv:inbox:conversationListScrollTop';
  const persistScrollTop = (value: number) => {
    scrollTopRef.current = value;
    try {
      localStorage.setItem(SCROLL_KEY, String(value));
    } catch {
      // noop
    }
  };

  useLayoutEffect(() => {
    const el = scrollElRef.current;
    if (!el || hasHydratedScrollRef.current) return;
    hasHydratedScrollRef.current = true;
    try {
      const raw = localStorage.getItem(SCROLL_KEY);
      const parsed = raw == null ? NaN : Number(raw);
      if (Number.isFinite(parsed) && parsed >= 0) {
        el.scrollTop = parsed;
        persistScrollTop(parsed);
      }
    } catch {
      // noop
    }
  }, []);

  useLayoutEffect(() => {
    const el = scrollElRef.current;
    if (!el) return;
    if (!hasUserScrolledRef.current && hasHydratedScrollRef.current) return;
    const target = scrollTopRef.current;
    if (Math.abs(el.scrollTop - target) > 1) {
      el.scrollTop = target;
    }
  }, [listSignature, isLoading, compact, selectedId]);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-transparent">
      <div className={`shrink-0 border-b border-[#e2e8f0] px-4 py-3 ${compact ? 'px-2.5' : ''}`}>
        <div className="flex items-center justify-between gap-2">
          <h2 className={`text-[15px] font-semibold text-[#0f172a] inline-flex items-center gap-2 ${compact ? 'sr-only' : ''}`}>
            Conversas
          </h2>
          {hasPendingRealtimeUpdates && (
            <button
              type="button"
              onClick={onApplyRealtimeUpdates}
              className={`rounded-full bg-[#eaf2ff] px-2 py-[2px] text-[10px] font-semibold text-[#1d4ed8] hover:bg-[#dbeafe] ${compact ? 'mx-auto' : ''}`}
              title="Aplicar novas conversas"
              aria-label="Aplicar novas conversas"
            >
              Novas
            </button>
          )}
          {onNewMessage && (
            <button
              type="button"
              onClick={onNewMessage}
              className={`inline-flex min-h-[30px] items-center rounded-full border border-[#cbd5e1] bg-white text-[11px] font-medium text-[#334155] shadow-[0_4px_12px_rgba(15,23,42,0.04)] transition-colors hover:border-[#93c5fd] hover:bg-[#eaf2ff] hover:text-[#123a73] ${compact ? 'h-8 w-8 justify-center px-0' : 'px-3'}`}
              title="Nova conversa"
              aria-label="Nova conversa"
            >
              {compact ? '+' : '+ Nova'}
            </button>
          )}
          {onToggleCollapsed && (
            <button
              type="button"
              onClick={onToggleCollapsed}
              className="inline-flex h-8 w-8 items-center justify-center rounded-[10px] border border-[#cbd5e1] bg-white text-[#334155] transition-colors hover:border-[#93c5fd] hover:bg-[#eaf2ff] hover:text-[#123a73]"
              title={compact ? 'Expandir conversas' : 'Recolher conversas'}
              aria-label={compact ? 'Expandir conversas' : 'Recolher conversas'}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {compact ? <path d="M9 18l6-6-6-6" /> : <path d="M15 18l-6-6 6-6" />}
              </svg>
            </button>
          )}
        </div>
      </div>

      <div
        ref={scrollElRef}
        className={`min-h-0 flex-1 overflow-y-auto py-2 ${compact ? 'px-1.5 pb-5' : 'px-2 pb-8'}`}
        onScroll={(e) => {
          const el = e.currentTarget;
          hasUserScrolledRef.current = true;
          persistScrollTop(el.scrollTop);
          onScrollMetaChange?.({
            scrollTop: el.scrollTop,
            nearTop: el.scrollTop < 24,
          });
        }}
      >
        {isLoading ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#2563eb] border-t-transparent" />
            <span className="text-[13px] text-[#64748b]">Carregando...</span>
          </div>
        ) : conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-4 py-16 text-center">
            <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mb-2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            <p className="text-[13px] text-[#94a3b8]">Nenhuma conversa encontrada</p>
          </div>
        ) : (
          <ul className="m-0 list-none space-y-1 p-0" role="list">
            {conversations.map((conv) => (
              <li key={conv.id}>
                <ConversationListItem
                  conversation={conv}
                  compact={compact}
                  isSelected={selectedId === conv.id}
                  onClick={() => {
                    const el = scrollElRef.current;
                    if (el) persistScrollTop(el.scrollTop);
                    hasUserScrolledRef.current = true;
                    onSelect(conv.id);
                  }}
                  onDelete={onDelete}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
