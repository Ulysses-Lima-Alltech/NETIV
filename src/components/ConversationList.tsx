import type { Conversation } from '../types';
import { ConversationListItem } from './ConversationListItem';

interface ConversationListProps {
  conversations: Conversation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDelete?: (id: string) => void;
  onNewMessage?: () => void;
  isLoading?: boolean;
}

export function ConversationList({
  conversations,
  selectedId,
  onSelect,
  onDelete,
  onNewMessage,
  isLoading = false,
}: ConversationListProps) {
  return (
    <div className="flex flex-col h-full bg-white border-r border-[#E5E7EB]">
      <div className="p-4 border-b border-[#E5E7EB] shrink-0">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-[15px] font-semibold text-[#111827]">Conversas</h2>
          {onNewMessage && (
            <button
              type="button"
              onClick={onNewMessage}
              className="shrink-0 inline-flex items-center gap-1.5 px-3 py-[7px] text-[13px] font-semibold text-white bg-[#F97316] rounded-[8px] hover:bg-[#EA580C] active:bg-[#C2410C] transition-colors shadow-sm"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Nova
            </button>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto min-h-0">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <div className="h-5 w-5 rounded-full border-2 border-[#3B82F6] border-t-transparent animate-spin" />
            <span className="text-[13px] text-[#6B7280]">Carregando…</span>
          </div>
        ) : conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
            <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#D1D5DB" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mb-2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            <p className="text-[13px] text-[#9CA3AF]">Nenhuma conversa encontrada</p>
          </div>
        ) : (
          <ul className="list-none p-0 m-0" role="list">
            {conversations.map((conv) => (
              <li key={conv.id}>
                <ConversationListItem conversation={conv} isSelected={selectedId === conv.id} onClick={() => onSelect(conv.id)} onDelete={onDelete} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
