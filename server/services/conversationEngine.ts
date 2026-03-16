import { getMessagesByConversationId } from '../repositories/messageRepository.js';
import { getOpenAIConfig } from '../repositories/openaiConfigRepository.js';
import { findOrCreateConversation, getConversationById } from '../repositories/conversationRepository.js';
import { insertMessage } from '../repositories/messageRepository.js';
import { buildPrompt, type HistoryMessage } from './promptBuilder.js';
import { routeAndGenerate } from './messageRouter.js';
import { sendTextMessage } from './whatsappMetaService.js';
import { analyzeLead } from './leadAnalyzer.js';
import type { LeadStage } from './leadAnalyzer.js';

export interface IncomingMessageContext {
  conversationId: number;
  userMessage: string;
  toPhoneNumber: string;
}

export async function handleIncomingMessage(ctx: IncomingMessageContext): Promise<void> {
  const { conversationId, userMessage, toPhoneNumber } = ctx;

  const aiConfig = getOpenAIConfig();
  if (!aiConfig?.aiEnabled || !aiConfig.openaiApiKey?.trim()) {
    return;
  }

  analyzeLead(conversationId);
  const conv = getConversationById(conversationId);
  const leadStage: LeadStage | undefined = conv?.lead_stage === 'COLD' || conv?.lead_stage === 'WARM' || conv?.lead_stage === 'HOT'
    ? (conv.lead_stage as LeadStage)
    : undefined;

  const rows = getMessagesByConversationId(conversationId);
  const history: HistoryMessage[] = rows.map((m) => ({
    role: m.direction === 'inbound' ? 'user' : 'assistant',
    content: m.content || m.body_text || '',
  }));

  const messages = buildPrompt(history, userMessage);
  const result = await routeAndGenerate(messages, userMessage, leadStage);

  if (!result.success || !result.content) {
    console.error('[ConversationEngine] IA não retornou resposta:', result.error);
    return;
  }

  const replyText = result.content;

  const sendResult = await sendTextMessage(toPhoneNumber, replyText);
  if (sendResult.success && sendResult.metaMessageId) {
    insertMessage(conversationId, 'outbound', sendResult.metaMessageId, 'sent', replyText, null);
  } else {
    console.error('[ConversationEngine] Falha ao enviar resposta WhatsApp:', sendResult.error);
  }
}
