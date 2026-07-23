export interface AnaHandoffConversationState {
  id?: number | string | null;
  contact_id?: number | string | null;
  handoff?: boolean | null;
  classification?: string | null;
  assigned_broker_id?: number | null;
}

export interface AnaHandoffBlockLogContext {
  conversationId: number | string;
  contactId?: number | string | null;
  automationType: string;
  blockedAt: 'inbound_entry' | 'before_ai' | 'before_enqueue' | 'worker_start' | 'before_send';
  source: string;
}

export function normalizeAnaHandoffClassification(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

/** A Ana nunca pode automatizar uma conversa com HANDOFF persistido. */
export function isAnaAutomationBlockedByHandoff(
  conversation: AnaHandoffConversationState | null | undefined
): boolean {
  if (!conversation) return false;
  return (
    conversation.handoff === true ||
    normalizeAnaHandoffClassification(conversation.classification) === 'handoff'
  );
}

export function logAnaAutomationBlockedByHandoff(
  conversation: AnaHandoffConversationState,
  context: AnaHandoffBlockLogContext
): void {
  console.log('[ANA_AUTOMATION_BLOCKED_HANDOFF]', {
    conversationId: context.conversationId,
    contactId: context.contactId ?? conversation.contact_id ?? null,
    automationType: context.automationType,
    blockedAt: context.blockedAt,
    handoff: conversation.handoff === true,
    classification: conversation.classification ?? null,
    assignedBrokerId: conversation.assigned_broker_id ?? null,
    source: context.source,
  });
}
