import type { Conversation } from '../types';
import { formatConversationTime, formatStatus } from '../utils/format';
import { FlameIcon } from './FlameIcon';

interface ConversationListItemProps {
  conversation: Conversation;
  isSelected: boolean;
  onClick: () => void;
}

export function ConversationListItem({ conversation, isSelected, onClick }: ConversationListItemProps) {
  const displayName = conversation.leadName.trim() || 'Lead sem nome';
  const projectDisplay = conversation.projectName || conversation.empreendimento;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Conversa com ${displayName}${conversation.unreadCount > 0 ? `, ${conversation.unreadCount} não lidas` : ''}`}
      className={`
        w-full text-left px-4 py-3.5 border-b border-[#F3F4F6] transition-all
        focus:outline-none focus-visible:ring-2 focus-visible:ring-[#3B82F6] focus-visible:ring-inset
        ${isSelected
          ? 'bg-[#EFF6FF] border-l-[3px] border-l-[#3B82F6]'
          : 'bg-white hover:bg-[#F9FAFB]'}
      `}
    >
      <div className="flex justify-between items-center gap-2 min-h-6">
        <span className={`font-medium truncate flex-1 text-[14px] leading-tight ${isSelected ? 'text-[#1D4ED8]' : 'text-[#111827]'}`}>
          {displayName}
        </span>
        <span className="text-[11px] text-[#9CA3AF] shrink-0 tabular-nums">
          {formatConversationTime(conversation.updatedAt)}
        </span>
      </div>
      <p className="text-[13px] text-[#6B7280] truncate mt-1 leading-snug">
        {conversation.lastMessage || 'Sem mensagens'}
      </p>
      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
        {projectDisplay && (
          <span className="inline-flex items-center text-[10px] font-semibold uppercase tracking-wide px-2 py-[2px] rounded bg-[#EFF6FF] text-[#3B82F6]">
            {projectDisplay}
          </span>
        )}
        <span title={`Lead ${conversation.temperatura}`} className="inline-flex items-center p-0.5">
          <FlameIcon temperatura={conversation.temperatura} size="sm" />
        </span>
        <span className="text-[10px] font-medium px-2 py-[2px] rounded bg-[#F3F4F6] text-[#6B7280]">
          {formatStatus(conversation.status)}
        </span>
        {conversation.unreadCount > 0 && (
          <span className="text-[10px] font-bold bg-[#F97316] text-white rounded-full min-w-[18px] h-[18px] px-1 flex items-center justify-center">
            {conversation.unreadCount}
          </span>
        )}
      </div>
    </button>
  );
}
