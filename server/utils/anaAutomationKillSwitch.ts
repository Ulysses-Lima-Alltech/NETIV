const ACTIVE_VALUES = new Set(['true', '1', 'yes', 'on']);

export const ANA_EMERGENCY_HANDOFF_ENV = 'ANA_EMERGENCY_HANDOFF';
export const ANA_AUTOMATION_DISABLED_ENV = 'ANA_AUTOMATION_DISABLED';
export const ANA_OUTBOUND_DISABLED_ENV = 'ANA_OUTBOUND_DISABLED';

export type AnaAutomationBlockReason =
  | 'ana_emergency_handoff_active'
  | 'ana_automation_disabled'
  | 'ana_outbound_disabled';

export interface AnaAutomationOutboundContext {
  source: string;
  conversationId?: number | string | null;
}

export type AnaAutomationBlockDecision =
  | { blocked: false }
  | {
      blocked: true;
      reason: AnaAutomationBlockReason;
      source: string;
      conversationId: number | string | null;
    };

function isActiveEnvValue(value: unknown): boolean {
  return ACTIVE_VALUES.has(String(value ?? '').trim().toLowerCase());
}

export function isAnaEmergencyHandoffEnabled(value = process.env[ANA_EMERGENCY_HANDOFF_ENV]): boolean {
  return isActiveEnvValue(value);
}

export function isAnaAutomationDisabled(value = process.env[ANA_AUTOMATION_DISABLED_ENV]): boolean {
  return isActiveEnvValue(value);
}

export function isAnaOutboundDisabled(value = process.env[ANA_OUTBOUND_DISABLED_ENV]): boolean {
  return isActiveEnvValue(value);
}

export function getAnaAutomationPauseReason(): AnaAutomationBlockReason | null {
  if (isAnaEmergencyHandoffEnabled()) return 'ana_emergency_handoff_active';
  if (isAnaAutomationDisabled()) return 'ana_automation_disabled';
  if (isAnaOutboundDisabled()) return 'ana_outbound_disabled';
  return null;
}

export function shouldBlockAnaAutomationOutbound(
  context: AnaAutomationOutboundContext
): AnaAutomationBlockDecision {
  const source = context.source || 'ana_unknown';
  const conversationId = context.conversationId ?? null;

  if (isAnaOutboundDisabled()) {
    return { blocked: true, reason: 'ana_outbound_disabled', source, conversationId };
  }
  if (isAnaAutomationDisabled()) {
    return { blocked: true, reason: 'ana_automation_disabled', source, conversationId };
  }
  if (isAnaEmergencyHandoffEnabled()) {
    return { blocked: true, reason: 'ana_emergency_handoff_active', source, conversationId };
  }

  return { blocked: false };
}

export function logAnaAutomationBlock(decision: AnaAutomationBlockDecision): void {
  if (!decision.blocked) return;
  const payload = {
    reason: decision.reason,
    source: decision.source,
    conversationId: decision.conversationId,
  };
  if (decision.reason === 'ana_automation_disabled') {
    console.log('[ANA_AUTOMATION_SKIP]', payload);
    return;
  }
  console.log('[ANA_OUTBOUND_BLOCKED]', payload);
}
