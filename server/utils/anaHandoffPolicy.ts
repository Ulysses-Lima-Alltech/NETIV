export interface AnaHandoffConversationState {
  id?: number | string | null;
  contact_id?: number | string | null;
  handoff?: boolean | null;
  classification?: string | null;
  assigned_broker_id?: number | null;
  manual_closed_at?: Date | string | null;
}

export interface AnaHandoffBlockLogContext {
  conversationId: number | string;
  contactId?: number | string | null;
  automationType: string;
  blockedAt: 'inbound_entry' | 'before_ai' | 'before_enqueue' | 'worker_start' | 'before_send';
  source: string;
  messageId?: number | string | null;
}

export function normalizeAnaHandoffClassification(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

/**
 * Kill switch canônico da Ana.
 *
 * ANA_HANDOFF_DISABLED controla somente a criação automática de novos
 * handoffs. Um HANDOFF já persistido sempre bloqueia a automação.
 * Corretor atribuído, isoladamente, não representa HANDOFF.
 */
export function isAnaAutomationBlockedByHandoff(
  conversation: AnaHandoffConversationState | null | undefined
): boolean {
  if (!conversation) return false;
  return (
    conversation.handoff === true ||
    normalizeAnaHandoffClassification(conversation.classification) === 'handoff'
  );
}

export function isAnaAutomationBlocked(
  conversation: AnaHandoffConversationState | null | undefined
): boolean {
  if (!conversation) return false;
  return isAnaAutomationBlockedByHandoff(conversation) || conversation.manual_closed_at != null;
}

function eventNameForBlockedAt(blockedAt: AnaHandoffBlockLogContext['blockedAt']): string {
  if (blockedAt === 'before_enqueue') return '[ANA_JOB_ENQUEUE_SKIPPED_HANDOFF]';
  if (blockedAt === 'worker_start') return '[ANA_JOB_CANCELLED_HANDOFF]';
  if (blockedAt === 'before_send') return '[ANA_OUTBOUND_ABORTED_HANDOFF]';
  return '[ANA_INBOUND_SKIPPED_HANDOFF]';
}

export function logAnaAutomationBlockedByHandoff(
  conversation: AnaHandoffConversationState,
  context: AnaHandoffBlockLogContext
): void {
  console.log(eventNameForBlockedAt(context.blockedAt), {
    conversationId: context.conversationId,
    contactId: context.contactId ?? conversation.contact_id ?? null,
    automationType: context.automationType,
    blockedAt: context.blockedAt,
    currentMode: conversation.handoff === true ? 'HANDOFF' : 'ANA',
    currentStatus: conversation.classification ?? null,
    funnelStatus: conversation.classification ?? null,
    messageId: context.messageId ?? null,
    handoff: conversation.handoff === true,
    classification: conversation.classification ?? null,
    assignedBrokerId: conversation.assigned_broker_id ?? null,
    reason: 'HANDOFF_BLOCKS_ANA_AUTOMATION',
    source: context.source,
  });
}
