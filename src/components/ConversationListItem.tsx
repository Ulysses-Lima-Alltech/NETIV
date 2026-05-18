import type { Conversation } from '../types';
import { formatConversationTime, formatStatus } from '../utils/format';
import { FlameIcon } from './FlameIcon';
import { ContactAvatar } from './ContactAvatar';

interface ConversationListItemProps {
  conversation: Conversation;
  isSelected: boolean;
  compact?: boolean;
  onClick: () => void;
  onDelete?: (id: string) => void;
}

export function ConversationListItem({
  conversation,
  isSelected,
  compact = false,
  onClick,
  onDelete,
}: ConversationListItemProps) {
  const displayName = conversation.leadName.trim() || 'Lead sem nome';
  const projectDisplay = conversation.projectName || conversation.empreendimento;
  const isUnread = conversation.unreadCount > 0;
  const isHandoff =
    conversation.handoff === true ||
    conversation.status === 'Handoff' ||
    conversation.classificationStatus === 'Handoff';
  const isCarteira =
    conversation.classificationStatus === 'Carteira' ||
    conversation.status === 'Carteira';

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete?.(conversation.id);
  };

  const activeStateClass = isHandoff
    ? 'bg-[#fff7ed] border-[#fdba74] shadow-[inset_4px_0_0_#f97316]'
    : isCarteira
      ? 'bg-[#f5f3ff] border-[#c4b5fd] shadow-[inset_4px_0_0_#8b5cf6]'
      : 'bg-[linear-gradient(135deg,#eaf2ff,white)] border-[rgba(59,130,246,0.45)] shadow-[inset_4px_0_0_#2563eb]';

  const restingStateClass = isHandoff
    ? 'border-transparent hover:border-[#fdba74] hover:bg-[#fff7ed]'
    : isCarteira
      ? 'border-transparent hover:border-[#ddd6fe] hover:bg-[#faf5ff]'
      : isUnread
        ? 'border-transparent hover:border-[#fed7aa] hover:bg-[#fff7ed]'
        : 'border-transparent hover:border-[#e2e8f0] hover:bg-[#f8fafc]';

  if (compact) {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onClick();
          }
        }}
        aria-label={`Conversa com ${displayName}${conversation.unreadCount > 0 ? `, ${conversation.unreadCount} nao lidas` : ''}`}
        className={`relative flex w-full cursor-pointer items-center justify-center rounded-[14px] border py-2 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb] ${isSelected ? activeStateClass : restingStateClass}`}
      >
        <ContactAvatar
          name={displayName}
          className="h-10 w-10 rounded-full border border-white/60 object-cover shadow-[0_2px_8px_rgba(15,23,42,0.08)]"
        />
        {conversation.unreadCount > 0 && (
          <span className="absolute right-1 top-1 flex h-[16px] min-w-[16px] items-center justify-center rounded-full bg-[#f97316] px-1 text-[9px] font-semibold text-white">
            {conversation.unreadCount}
          </span>
        )}
      </div>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      aria-label={`Conversa com ${displayName}${conversation.unreadCount > 0 ? `, ${conversation.unreadCount} nao lidas` : ''}`}
      className={`group w-full cursor-pointer rounded-[17px] border px-3 py-3 text-left transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb] ${isSelected ? activeStateClass : restingStateClass}`}
    >
      <div className="flex min-h-6 items-center gap-2">
        <ContactAvatar
          name={displayName}
          className="h-9 w-9 rounded-full border border-white/70 object-cover shadow-[0_2px_8px_rgba(15,23,42,0.07)]"
        />
        <span className={`flex-1 truncate text-[13px] leading-tight ${isSelected || isUnread ? 'font-semibold text-[#0f172a]' : 'font-medium text-[#0f172a]'}`}>
          {displayName}
        </span>
        <span className="shrink-0 text-[11px] font-medium tabular-nums text-[#94a3b8]">
          {formatConversationTime(conversation.updatedAt)}
        </span>
        {onDelete && (
          <button
            type="button"
            onClick={handleDelete}
            aria-label="Excluir conversa"
            className="shrink-0 rounded-[8px] p-1 text-[#94a3b8] opacity-0 transition-all hover:bg-red-50 hover:text-red-600 group-hover:opacity-100"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
          </button>
        )}
      </div>

      <p className={`mt-1 truncate text-[12px] leading-snug ${isUnread ? 'font-medium text-[#334155]' : 'text-[#64748b]'}`}>
        {conversation.lastMessage || 'Sem mensagens'}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {isHandoff && (
          <span className="inline-flex items-center rounded-full bg-[#fff2e8] px-2 py-[3px] text-[10px] font-medium text-[#c2410c]">
            Handoff
          </span>
        )}

        {!isHandoff && isCarteira && (
          <span className="inline-flex items-center rounded-full bg-[#ede9fe] px-2 py-[3px] text-[10px] font-medium text-[#6d28d9]">
            Carteira
          </span>
        )}

        {isHandoff && conversation.assignedBrokerName?.trim() && (
          <span
            className="inline-flex max-w-[140px] items-center truncate rounded-full border border-[#a7f3d0] bg-[#ecfdf5] px-2 py-[3px] text-[10px] font-medium text-[#047857]"
            title={conversation.assignedBrokerName}
          >
            {conversation.assignedBrokerName}
          </span>
        )}

        {projectDisplay && (
          <span className="inline-flex items-center rounded-full bg-[#eaf2ff] px-2 py-[3px] text-[10px] font-medium text-[#123a73]">
            {projectDisplay}
          </span>
        )}

        <span title={`Lead ${conversation.temperatura ?? 'nao definida'}`} className="inline-flex items-center p-0.5">
          <FlameIcon temperatura={conversation.temperatura} size="sm" />
        </span>

        {!isHandoff && !isCarteira && (
          <span className="rounded-full bg-[#f1f5f9] px-2 py-[3px] text-[10px] font-medium text-[#64748b]">
            {formatStatus(conversation.status)}
          </span>
        )}

        {conversation.unreadCount > 0 && (
          <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#f97316] px-1 text-[10px] font-semibold text-white">
            {conversation.unreadCount}
          </span>
        )}
      </div>
    </div>
  );
}
