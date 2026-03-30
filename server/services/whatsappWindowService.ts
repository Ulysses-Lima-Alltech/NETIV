import { findLatestWhatsAppConversationByPhoneDigits } from '../repositories/conversationRepository.js';
import { getLastInboundUserMessageAt } from '../repositories/messageRepository.js';

const WINDOW_MS = 24 * 60 * 60 * 1000;

export type WhatsAppWindowReason = 'open' | 'no_inbound' | 'expired';

export interface WhatsAppWindowStatus {
  isOpen: boolean;
  lastInboundAt: string | null;
  closesAt: string | null;
  reason: WhatsAppWindowReason;
}

function buildWindowStatus(lastInboundAt: Date | null, now = Date.now()): WhatsAppWindowStatus {
  if (!lastInboundAt) {
    return { isOpen: false, lastInboundAt: null, closesAt: null, reason: 'no_inbound' };
  }
  const lastMs = new Date(lastInboundAt).getTime();
  const closesMs = lastMs + WINDOW_MS;
  if (Number.isNaN(lastMs)) {
    return { isOpen: false, lastInboundAt: null, closesAt: null, reason: 'no_inbound' };
  }
  const isOpen = now < closesMs;
  return {
    isOpen,
    lastInboundAt: new Date(lastMs).toISOString(),
    closesAt: new Date(closesMs).toISOString(),
    reason: isOpen ? 'open' : 'expired',
  };
}

export async function getConversationWhatsAppWindowStatus(conversationId: number): Promise<WhatsAppWindowStatus> {
  const lastInboundAt = await getLastInboundUserMessageAt(conversationId);
  return buildWindowStatus(lastInboundAt);
}

export async function getPhoneWhatsAppWindowStatus(phone: string): Promise<{
  conversationId: number | null;
  window: WhatsAppWindowStatus;
}> {
  const conv = await findLatestWhatsAppConversationByPhoneDigits(phone);
  if (!conv) {
    return {
      conversationId: null,
      window: { isOpen: false, lastInboundAt: null, closesAt: null, reason: 'no_inbound' },
    };
  }
  const window = await getConversationWhatsAppWindowStatus(conv.id);
  return { conversationId: conv.id, window };
}

