export interface AnaHandoffConversationLike {
  id?: number | null;
  handoff?: boolean | null;
  classification?: string | null;
  contact_id?: number | null;
  assigned_broker_id?: number | null;
}

export type AnaHandoffBlockedAt =
  | 'inbound_entry'
  | 'before_ai'
  | 'before_enqueue'
  | 'worker_start'
  | 'before_send'
  | 'before_reschedule';

export function normalizeAnaHandoffClassification(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

export function isAnaAutomationBlockedByHandoff(
  conversation: AnaHandoffConversationLike | null | undefined
): boolean {
  if (!conversation) return false;
  return (
    conversation.handoff === true ||
    normalizeAnaHandoffClassification(conversation.classification) === 'handoff'
  );
}

function eventForBlockedAt(blockedAt: AnaHandoffBlockedAt): string {
  if (blockedAt === 'before_enqueue') return 'ANA_JOB_ENQUEUE_SKIPPED_HANDOFF';
  if (blockedAt === 'worker_start' || blockedAt === 'before_reschedule') return 'ANA_JOB_CANCELLED_HANDOFF';
  if (blockedAt === 'before_send') return 'ANA_OUTBOUND_ABORTED_HANDOFF';
  return 'ANA_INBOUND_SKIPPED_HANDOFF';
}

export function logAnaAutomationBlockedByHandoff(
  conversation: AnaHandoffConversationLike,
  params: {
    conversationId: number;
    automationType: string;
    blockedAt: AnaHandoffBlockedAt;
    source: string;
    metaMessageId?: string | null;
    jobId?: number | null;
  }
): void {
  console.log(`[${eventForBlockedAt(params.blockedAt)}]`, {
    conversationId: params.conversationId,
    conversationRowId: conversation.id ?? null,
    automationType: params.automationType,
    blockedAt: params.blockedAt,
    source: params.source,
    reason: 'handoff',
    handoff: conversation.handoff === true,
    classification: conversation.classification ?? null,
    contactId: conversation.contact_id ?? null,
    assignedBrokerId: conversation.assigned_broker_id ?? null,
    metaMessageId: params.metaMessageId ?? null,
    jobId: params.jobId ?? null,
  });
}
