export type InboxTab = 'CLIENT' | 'INTERNO';

interface ConversationTabInfo {
  conversationType?: string;
  isEventLead?: boolean;
}

export function getInboxTab(conversation: ConversationTabInfo): InboxTab {
  const type = String(conversation.conversationType ?? 'CLIENT').toUpperCase();
  if (type === 'ADMIN' || type === 'CORRETOR' || conversation.isEventLead === true) return 'INTERNO';
  return 'CLIENT';
}

export function matchesInboxTab(conversation: ConversationTabInfo, tab: InboxTab): boolean {
  return getInboxTab(conversation) === tab;
}
