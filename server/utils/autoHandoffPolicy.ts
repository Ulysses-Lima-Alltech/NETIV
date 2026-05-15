export function isAutoHandoffEnabled(): boolean {
  const raw = String(process.env.AUTO_HANDOFF_ENABLED ?? '').trim().toLowerCase();
  if (raw === '') return false;
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

export function logAutoHandoffBlocked(params: {
  origin: string;
  conversationId?: number | null;
  reason: string;
  requestedClassification?: string | null;
  requestedHandoff?: boolean | null;
}): void {
  console.warn('auto_handoff_blocked_by_temporary_policy', {
    origin: params.origin,
    conversationId: params.conversationId ?? null,
    reason: params.reason,
    requestedClassification: params.requestedClassification ?? null,
    requestedHandoff: params.requestedHandoff ?? null,
    autoHandoffEnabled: isAutoHandoffEnabled(),
  });
}
