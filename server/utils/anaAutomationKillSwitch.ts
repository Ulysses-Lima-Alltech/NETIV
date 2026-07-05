import { AsyncLocalStorage } from 'node:async_hooks';

const ACTIVE_VALUES = new Set(['true', '1', 'yes', 'on']);

export const ANA_EMERGENCY_HANDOFF_ENV = 'ANA_EMERGENCY_HANDOFF';
export const ANA_AUTOMATION_DISABLED_ENV = 'ANA_AUTOMATION_DISABLED';
export const ANA_OUTBOUND_DISABLED_ENV = 'ANA_OUTBOUND_DISABLED';
export const ANA_DIRECT_INBOUND_REPLY_ENABLED_ENV = 'ANA_DIRECT_INBOUND_REPLY_ENABLED';

export type AnaAutomationBlockReason =
  | 'ana_emergency_handoff_active'
  | 'ana_automation_disabled'
  | 'ana_outbound_disabled';

export interface AnaAutomationOutboundContext {
  source: string;
  conversationId?: number | string | null;
}

interface AnaAutomationOutboundScope {
  source: string;
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

const outboundSourceScope = new AsyncLocalStorage<AnaAutomationOutboundScope>();

export function isAnaEmergencyHandoffEnabled(value = process.env[ANA_EMERGENCY_HANDOFF_ENV]): boolean {
  return isActiveEnvValue(value);
}

export function isAnaAutomationDisabled(value = process.env[ANA_AUTOMATION_DISABLED_ENV]): boolean {
  return isActiveEnvValue(value);
}

export function isAnaOutboundDisabled(value = process.env[ANA_OUTBOUND_DISABLED_ENV]): boolean {
  return isActiveEnvValue(value);
}

export function isAnaDirectInboundReplyEnabled(
  value = process.env[ANA_DIRECT_INBOUND_REPLY_ENABLED_ENV]
): boolean {
  return isActiveEnvValue(value);
}

function normalizeSource(source: string | null | undefined): string {
  return String(source || 'ana_unknown').trim() || 'ana_unknown';
}

function allowsDirectInboundAutomationBypass(source: string): boolean {
  return (
    source === 'ana_inbound_engine' &&
    isAnaDirectInboundReplyEnabled() &&
    !isAnaEmergencyHandoffEnabled()
  );
}

function getScopedOutboundSource(defaultSource: string): string {
  return normalizeSource(outboundSourceScope.getStore()?.source ?? defaultSource);
}

export function runWithAnaAutomationOutboundSource<T>(source: string, fn: () => T): T {
  return outboundSourceScope.run({ source: normalizeSource(source) }, fn);
}

export function getAnaAutomationPauseReason(
  context?: Partial<AnaAutomationOutboundContext>
): AnaAutomationBlockReason | null {
  const source = normalizeSource(context?.source);
  if (isAnaEmergencyHandoffEnabled()) return 'ana_emergency_handoff_active';
  if (isAnaOutboundDisabled()) return 'ana_outbound_disabled';
  if (isAnaAutomationDisabled() && !allowsDirectInboundAutomationBypass(source)) {
    return 'ana_automation_disabled';
  }
  return null;
}

export function shouldBlockAnaAutomationOutbound(
  context: AnaAutomationOutboundContext
): AnaAutomationBlockDecision {
  const source = getScopedOutboundSource(context.source);
  const conversationId = context.conversationId ?? null;

  if (isAnaOutboundDisabled()) {
    return { blocked: true, reason: 'ana_outbound_disabled', source, conversationId };
  }
  if (isAnaAutomationDisabled() && !allowsDirectInboundAutomationBypass(source)) {
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
