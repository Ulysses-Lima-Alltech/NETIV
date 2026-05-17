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
    <div className="flex h-full min-h-0 flex-col bg-transparent">
      <div className="shrink-0 border-b border-[#e2e8f0] px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-[15px] font-semibold text-[#0f172a]">Conversas</h2>
          {onNewMessage && (
            <button
              type="button"
              onClick={onNewMessage}
              className="inline-flex min-h-[30px] items-center rounded-full border border-[#cbd5e1] bg-white px-3 text-[11px] font-medium text-[#334155] shadow-[0_4px_12px_rgba(15,23,42,0.04)] transition-colors hover:border-[#93c5fd] hover:bg-[#eaf2ff] hover:text-[#123a73]"
            >
              + Nova
            </button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
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
                  isSelected={selectedId === conv.id}
                  onClick={() => onSelect(conv.id)}
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
