import type { Conversation } from '../types';
import { formatConversationTime, formatStatus } from '../utils/format';
import { FlameIcon } from './FlameIcon';

interface ConversationListItemProps {
  conversation: Conversation;
  isSelected: boolean;
  onClick: () => void;
  onDelete?: (id: string) => void;
}

export function ConversationListItem({ conversation, isSelected, onClick, onDelete }: ConversationListItemProps) {
  const displayName = conversation.leadName.trim() || 'Lead sem nome';
  const projectDisplay = conversation.projectName || conversation.empreendimento;

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete?.(conversation.id);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      aria-label={`Conversa com ${displayName}${conversation.unreadCount > 0 ? `, ${conversation.unreadCount} não lidas` : ''}`}
      className={`
        group relative w-full text-left px-4 py-3.5 border-b border-[#F3F4F6] transition-all cursor-pointer
        focus:outline-none focus-visible:ring-2 focus-visible:ring-[#3B82F6] focus-visible:ring-inset
        ${(conversation.handoff === true || conversation.status === 'Handoff' || conversation.classificationStatus === 'Handoff')
          ? isSelected
            ? 'bg-[#FEF2F2] border-l-[3px] border-l-[#DC2626]'
            : 'bg-[#FFFBEB] hover:bg-[#FEF3C7] border-l-[3px] border-l-[#F59E0B]'
          : isSelected
            ? 'bg-[#EFF6FF] border-l-[3px] border-l-[#3B82F6]'
            : 'bg-white hover:bg-[#F9FAFB]'}
      `}
    >
      {onDelete && (
        <button
          type="button"
          onClick={handleDelete}
          aria-label="Excluir conversa"
          className="absolute top-2.5 right-2 opacity-0 group-hover:opacity-100 p-1.5 rounded-[6px] text-[#9CA3AF] hover:text-red-600 hover:bg-red-50 transition-all"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
        </button>
      )}
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
        {(conversation.handoff === true || conversation.status === 'Handoff' || conversation.classificationStatus === 'Handoff') && (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-[2px] rounded bg-[#FEF2F2] text-[#DC2626] border border-[#FECACA]">
            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            Handoff
          </span>
        )}
        {projectDisplay && (
          <span className="inline-flex items-center text-[10px] font-semibold uppercase tracking-wide px-2 py-[2px] rounded bg-[#EFF6FF] text-[#3B82F6]">
            {projectDisplay}
          </span>
        )}
        <span title={`Lead ${conversation.temperatura}`} className="inline-flex items-center p-0.5">
          <FlameIcon temperatura={conversation.temperatura} size="sm" />
        </span>
        {!conversation.handoff && conversation.status !== 'Handoff' && conversation.classificationStatus !== 'Handoff' && (
          <span className="text-[10px] font-medium px-2 py-[2px] rounded bg-[#F3F4F6] text-[#6B7280]">
            {formatStatus(conversation.status)}
          </span>
        )}
        {conversation.unreadCount > 0 && (
          <span className="text-[10px] font-bold bg-[#F97316] text-white rounded-full min-w-[18px] h-[18px] px-1 flex items-center justify-center">
            {conversation.unreadCount}
          </span>
        )}
      </div>
    </div>
  );
}
