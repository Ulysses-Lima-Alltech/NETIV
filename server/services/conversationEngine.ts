import { getMessagesByConversationId, insertMessage } from '../repositories/messageRepository.js';
import { getOpenAIConfig } from '../repositories/openaiConfigRepository.js';
import {
  getConversationById,
  setConversationEnterpriseId,
  applyAnaConversationUpdate,
} from '../repositories/conversationRepository.js';
import { sendTextMessage, sendDocumentMessage } from './whatsappMetaService.js';
import { tryMatchActiveEnterpriseId } from '../repositories/enterpriseMatch.js';
import {
  getActiveEnterpriseById,
  loadAgentKnowledgeText,
  listEnterpriseFiles,
  getFileForSend,
  getVariablesMap,
  logSentFile,
  type FileCategory,
} from '../repositories/enterpriseRepository.js';
import { generateChatCompletion, type ChatMessage } from './openaiService.js';
import { buildAnaSystemPrompt, parseAnaJson, fallbackReplyFromRaw } from './anaAgentService.js';

export interface IncomingMessageContext {
  conversationId: number;
  userMessage: string;
  toPhoneNumber: string;
}

const MAX_HISTORY = 14;

function rowsToHistory(
  rows: { role: string; content: string | null }[],
  excludeLastUserText: string | null
): { role: 'user' | 'assistant'; content: string }[] {
  let list = rows.map((m) => ({
    role: (m.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
    content: (m.content || '').trim(),
  }));
  if (
    excludeLastUserText &&
    list.length > 0 &&
    list[list.length - 1].role === 'user' &&
    list[list.length - 1].content === excludeLastUserText.trim()
  ) {
    list = list.slice(0, -1);
  }
  return list.filter((m) => m.content.length > 0).slice(-MAX_HISTORY);
}

export async function handleIncomingMessage(ctx: IncomingMessageContext): Promise<void> {
  const { conversationId, userMessage, toPhoneNumber } = ctx;
  const trimmed = userMessage.trim();
  if (!trimmed) return;

  const aiConfig = await getOpenAIConfig();
  if (!aiConfig?.openaiApiKey?.trim()) {
    console.warn('[ConversationEngine] OpenAI API Key não configurada — ignorando mensagem.');
    return;
  }

  let conv = await getConversationById(conversationId);
  if (!conv) return;

  if (!conv.enterprise_id) {
    const matched = await tryMatchActiveEnterpriseId(trimmed);
    if (matched) {
      await setConversationEnterpriseId(conversationId, matched);
      conv = (await getConversationById(conversationId))!;
    }
  }

  const ent = conv.enterprise_id ? await getActiveEnterpriseById(conv.enterprise_id) : null;
  const inactiveLinked = Boolean(conv.enterprise_id && !ent);

  let mode: 'triage' | 'scoped' | 'inactive_linked' = 'triage';
  if (inactiveLinked) mode = 'inactive_linked';
  else if (ent) mode = 'scoped';

  const vars = ent ? await getVariablesMap(ent.id) : {};
  const knowledgeText = ent ? await loadAgentKnowledgeText(ent.id) : '';
  let fileInventory = '';
  if (ent) {
    const files = await listEnterpriseFiles(ent.id);
    fileInventory = files
      .filter((f) => f.is_active)
      .map((f) => `${f.category}: ${f.original_name}`)
      .join('; ');
  }

  const systemPrompt = buildAnaSystemPrompt({
    mode,
    enterprise: ent,
    variablesMap: vars,
    knowledgeText,
    fileInventory,
  });

  const rows = await getMessagesByConversationId(conversationId);
  const history = rowsToHistory(rows, trimmed);

  const messages: ChatMessage[] = [{ role: 'system', content: systemPrompt }];
  for (const h of history) {
    messages.push({ role: h.role, content: h.content });
  }
  messages.push({ role: 'user', content: trimmed });

  const model = aiConfig.modelColdLead || aiConfig.modelHotLead || 'gpt-4o-mini';
  const result = await generateChatCompletion({
    apiKey: aiConfig.openaiApiKey,
    baseUrl: aiConfig.openaiBaseUrl,
    model,
    messages,
    temperature: Math.min(aiConfig.temperature ?? 0.5, 0.75),
    maxTokens: Math.max(aiConfig.maxTokens ?? 600, 800),
    responseFormatJson: true,
  });

  let structured =
    result.success && result.content ? parseAnaJson(result.content) : null;
  if (!structured && result.success && result.content) {
    structured = fallbackReplyFromRaw(result.content);
  }
  if (!structured) {
    structured = {
      reply: 'Oi — manda de novo em uma linha o que você precisa?',
      classification: 'Novo',
      lead_temperature: 'frio',
      project: ent?.name || '',
      handoff: false,
      customer_name: '',
      summary: result.error || '',
      send_file_category: null,
    };
  }

  await applyAnaConversationUpdate(conversationId, {
    classification: structured.classification,
    lead_temperature: structured.lead_temperature,
    customer_name: structured.customer_name,
    handoff: structured.handoff,
  });

  const replyText = structured.reply.slice(0, 4000);
  const sendResult = await sendTextMessage(toPhoneNumber, replyText);
  if (sendResult.success && sendResult.metaMessageId) {
    await insertMessage(conversationId, 'assistant', replyText, sendResult.metaMessageId);
  } else {
    console.error('[ConversationEngine] Falha ao enviar WhatsApp:', sendResult.error);
  }

  const cat = structured.send_file_category;
  const eid = conv.enterprise_id;
  if (cat && eid && ent && eid === ent.id) {
    const file = await getFileForSend(eid, cat as FileCategory);
    if (file) {
      const docRes = await sendDocumentMessage(toPhoneNumber, file.path, file.originalName);
      if (docRes.success) {
        await logSentFile(conversationId, file.id);
        const mid = docRes.metaMessageId || `doc-${Date.now()}`;
        await insertMessage(conversationId, 'assistant', `[Arquivo: ${file.originalName}]`, mid);
      }
    }
  }
}
