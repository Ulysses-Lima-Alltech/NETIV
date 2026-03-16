import type { Conversation, Empreendimento } from '../types';
import { formatConversationTime, formatStatus } from '../utils/format';
import { FlameIcon } from './FlameIcon';

const empreendimentoStyles: Record<Empreendimento, string> = {
  Montaresa: 'bg-violet-100 text-violet-800 border-violet-200',
  Evora: 'bg-amber-100 text-amber-800 border-amber-200',
};

interface ConversationListItemProps {
  conversation: Conversation;
  isSelected: boolean;
  onClick: () => void;
}

export function ConversationListItem({ conversation, isSelected, onClick }: ConversationListItemProps) {
  const displayName = conversation.leadName.trim() || 'Lead sem nome';
  const projectDisplay = conversation.projectName || conversation.empreendimento;
  const empreendimentoClass = conversation.empreendimento
    ? empreendimentoStyles[conversation.empreendimento]
    : 'bg-gray-100 text-gray-600 border-gray-200';

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Conversa com ${displayName}${conversation.unreadCount > 0 ? `, ${conversation.unreadCount} não lidas` : ''}`}
      className={`
        w-full text-left px-4 py-3.5 border-b border-gray-100 transition-colors
        focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1
        ${isSelected ? 'bg-gray-100 border-l-4 border-l-blue-500' : 'bg-white hover:bg-gray-50'}
      `}
    >
      <div className="flex justify-between items-center gap-2 min-h-6">
        <span className="font-medium text-gray-900 truncate flex-1 text-[15px] leading-tight">
          {displayName}
        </span>
        <span className="text-xs text-gray-500 shrink-0 tabular-nums">
          {formatConversationTime(conversation.updatedAt)}
        </span>
      </div>
      <p className="text-sm text-gray-600 truncate mt-1 leading-snug">
        {conversation.lastMessage || 'Sem mensagens'}
      </p>
      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
        {projectDisplay && (
          <span
            className={`inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded border ${empreendimentoClass}`}
            title="Projeto"
          >
            {projectDisplay}
          </span>
        )}
        <span title={`Lead ${conversation.temperatura}`} className="inline-flex items-center p-0.5">
          <FlameIcon temperatura={conversation.temperatura} size="sm" />
        </span>
        <span className="text-[11px] px-2 py-0.5 rounded bg-gray-200 text-gray-700 border border-gray-200">
          {formatStatus(conversation.status)}
        </span>
        {conversation.unreadCount > 0 && (
          <span className="text-[11px] font-semibold bg-blue-500 text-white rounded-full min-w-5 h-5 px-1.5 flex items-center justify-center">
            {conversation.unreadCount}
          </span>
        )}
      </div>
    </button>
  );
}
