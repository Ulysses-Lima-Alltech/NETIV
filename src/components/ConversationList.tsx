import { useState, useMemo } from 'react';
import type { Conversation } from '../types';
import { ConversationListItem } from './ConversationListItem';

interface ConversationListProps {
  conversations: Conversation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNewMessage?: () => void;
  isLoading?: boolean;
}

export function ConversationList({
  conversations,
  selectedId,
  onSelect,
  onNewMessage,
  isLoading = false,
}: ConversationListProps) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search.trim()) return conversations;
    const q = search.trim().toLowerCase();
    return conversations.filter(
      (c) =>
        (c.leadName || '').toLowerCase().includes(q) ||
        (c.leadPhone || '').replace(/\D/g, '').includes(q.replace(/\D/g, '')) ||
        c.lastMessage.toLowerCase().includes(q)
    );
  }, [conversations, search]);

  return (
    <div className="flex flex-col h-full bg-white border-r border-gray-200">
      <div className="p-4 border-b border-gray-200 shrink-0">
        <div className="flex items-center justify-between gap-2 mb-3">
          <h2 className="text-base font-semibold text-gray-900">Conversas</h2>
          {onNewMessage && (
            <button
              type="button"
              onClick={onNewMessage}
              className="shrink-0 px-3 py-1.5 text-sm font-medium text-white bg-blue-500 rounded-lg hover:bg-blue-600"
            >
              Nova mensagem
            </button>
          )}
        </div>
        <input
          type="search"
          placeholder="Buscar por nome, telefone ou mensagem..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Buscar conversas"
          className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
        />
      </div>
      <div className="flex-1 overflow-y-auto min-h-0">
        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-gray-500">Carregando...</div>
        ) : filtered.length === 0 ? (
          <p className="p-4 text-sm text-gray-500 text-center">Nenhuma conversa encontrada</p>
        ) : (
          <ul className="list-none p-0 m-0" role="list">
            {filtered.map((conv) => (
              <li key={conv.id}>
                <ConversationListItem
                  conversation={conv}
                  isSelected={selectedId === conv.id}
                  onClick={() => onSelect(conv.id)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
