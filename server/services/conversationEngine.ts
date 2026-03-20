import { getMessagesByConversationId, getLastUserMessageNeedingReply, insertMessage } from '../repositories/messageRepository.js';
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
  getEnterpriseById,
  loadAgentKnowledgeText,
  listEnterpriseFiles,
  getFileForSend,
  getVariablesMap,
  logSentFile,
  listEnterprises,
  type FileCategory,
  type EnterpriseRow,
} from '../repositories/enterpriseRepository.js';
import { generateChatCompletion, type ChatMessage } from './openaiService.js';
import { buildAnaSystemPrompt, type BuildAnaSystemPromptOpts, parseAnaJson, fallbackReplyFromRaw } from './anaAgentService.js';
import { validateAnaReply, logAnaReplyBlocked } from './anaReplyGuard.js';

export interface IncomingMessageContext {
  conversationId: number;
  userMessage: string;
  toPhoneNumber: string;
}

/** Reprocessa a última mensagem do usuário sem resposta quando handoff muda true→false. */
export async function reprocessLastUserMessage(conversationId: number): Promise<void> {
  console.log('[ANA REPROCESS]', { conversationId });
  const conv = await getConversationById(conversationId);
  if (!conv) return;
  const toPhoneNumber = (conv.contact_phone || conv.external_contact_id || '').trim();
  if (!toPhoneNumber) {
    console.warn('[ConversationEngine] reprocessLastUserMessage: sem telefone na conversa', conversationId);
    return;
  }
  const lastUserMsg = await getLastUserMessageNeedingReply(conversationId);
  if (!lastUserMsg?.content?.trim()) return;
  console.log('[ConversationEngine] Reprocessando última mensagem pendente ao sair de handoff', { conversationId });
  await handleIncomingMessage({
    conversationId,
    userMessage: lastUserMsg.content,
    toPhoneNumber,
  });
}

/** Lock leve por conversationId: garante que apenas UMA mensagem por conversa seja processada por vez. */
const processingConversations = new Map<string, Promise<void>>();

async function acquireConversationLock(conversationId: number): Promise<() => void> {
  const key = String(conversationId);
  const prev = processingConversations.get(key) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((r) => { release = r; });
  processingConversations.set(key, prev.then(() => next));
  await prev;
  return release;
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

const SWITCH_INTENT_PATTERNS = [
  'agora quero', 'quero saber do', 'quero saber sobre', 'quero informacoes do', 'quero informacoes sobre',
  'quero falar do', 'quero falar sobre', 'quero falar sobre o', 'quero falar sobre a',
  'tenho interesse no', 'tenho interesse em',
  'me passe mais', 'me passe mais informacoes', 'me passe mais informacoes do', 'me passe mais informacoes sobre',
  'me passa mais', 'me passa mais informacoes', 'me passa mais informacoes do', 'me passa mais informacoes sobre',
  'troca para', 'trocar para', 'muda para', 'mudar para',
  'nao quero mais', 'nao gostei desse', 'prefiro o', 'nao me interessa mais',
  'me fala do', 'me fala sobre', 'fala do', 'fala sobre', 'quero o ',
];

const HANDOFF_INTENT_PATTERNS = [
  'quero falar com um humano', 'quero falar com humano', 'falar com um humano',
  'quero um atendente', 'quero atendente', 'preciso de atendente',
  'prefiro falar com uma pessoa', 'prefiro falar com pessoa', 'falar com pessoa',
  'me passa para alguem', 'passa para alguem', 'me passa um atendente',
  'quero atendimento humano', 'atendimento humano',
  'transferir para humano', 'transfere para humano',
  'quero ser atendido por pessoa', 'atendido por pessoa',
  'preciso falar com humano', 'preciso de um humano',
];

function normText(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/\s+/g, ' ').trim();
}

function hasExplicitSwitchIntent(message: string): boolean {
  return SWITCH_INTENT_PATTERNS.some((p) => normText(message).includes(p));
}

function tryMatchEnterpriseByLastMention(activeEnterprises: EnterpriseRow[], message: string): number | null {
  const lower = normText(message);
  let anchorIndex = -1;
  let anchorLen = 0;

  for (const p of SWITCH_INTENT_PATTERNS) {
    const idx = lower.lastIndexOf(p);
    if (idx > anchorIndex) {
      anchorIndex = idx;
      anchorLen = p.length;
    }
  }

  const tail = anchorIndex >= 0 ? lower.slice(anchorIndex + anchorLen) : lower;

  let best: { id: number; lastIndex: number } | null = null;

  for (const p of activeEnterprises) {
    const nameNorm = normText(p.name);
    const slugNorm = normText(p.slug || '');

    let lastIndex = -1;
    if (nameNorm.length >= 2) {
      lastIndex = Math.max(lastIndex, tail.lastIndexOf(nameNorm));
    }
    if (slugNorm.length >= 2) {
      lastIndex = Math.max(lastIndex, tail.lastIndexOf(slugNorm));
    }

    if (lastIndex >= 0 && (!best || lastIndex > best.lastIndex)) {
      best = { id: p.id, lastIndex };
    }
  }

  return best?.id ?? null;
}

function hasExplicitHandoffIntent(message: string): boolean {
  return HANDOFF_INTENT_PATTERNS.some((p) => normText(message).includes(p));
}

export async function handleIncomingMessage(ctx: IncomingMessageContext): Promise<void> {
  const { conversationId, userMessage, toPhoneNumber } = ctx;

  console.log('[ANA DEBUG] handleIncomingMessage start', { conversationId, toPhoneNumber });

  const release = await acquireConversationLock(conversationId);
  try {
    const trimmed = userMessage.trim();
    if (!trimmed) {
      console.log('[ANA DEBUG] mensagem vazia após trim — ignorando');
      return;
    }

    const aiConfig = await getOpenAIConfig();
    console.log('[ANA DEBUG] aiConfig loaded (handleIncomingMessage)', {
      hasConfig: !!aiConfig,
      hasApiKey: !!aiConfig?.openaiApiKey?.trim(),
      aiEnabled: aiConfig?.aiEnabled,
      conversationId,
    });
    if (!aiConfig) {
      console.error('[ANA DEBUG] getOpenAIConfig retornou null — ignorando mensagem.');
      return;
    }
    if (!aiConfig.openaiApiKey?.trim()) {
      console.warn('[ANA DEBUG] OpenAI API Key não configurada — ignorando mensagem.');
      return;
    }
    if (!aiConfig.aiEnabled) {
      console.log('[ANA DEBUG] aiEnabled check blocked — ai_enabled=false no banco.');
      return;
    }
    console.log('[ANA DEBUG] aiEnabled check passed');

    let conv = await getConversationById(conversationId);
    if (!conv) {
      console.error('[ANA DEBUG] conversa inexistente', { conversationId });
      return;
    }
    console.log('[ANA DEBUG] conversation loaded', { conversationId, handoff: conv.handoff, classification: conv.classification });

    // Revalidação imediata antes do bloqueio: sempre buscar estado mais recente (evita race: usuário muda Handoff→ANA durante processamento)
    const latestConv = await getConversationById(conversationId);
    let effectiveConv = latestConv ?? conv;

    console.log('[ANA DEBUG] handoff check', {
      handoff: effectiveConv.handoff,
      classification: effectiveConv.classification,
      conversationId,
    });

    // Decisão final SEMPRE com base no estado mais recente. Modo handoff: NÃO responder. Modo ANA: SEMPRE responder via IA.
    if (effectiveConv.handoff === true || effectiveConv.classification === 'Handoff') {
      console.log('[ANA DEBUG] handoff check blocked — conversa em modo humano, ANA não responde', {
        conversationId,
        handoff: effectiveConv.handoff,
        classification: effectiveConv.classification,
      });
      return;
    }
    console.log('[ANA DEBUG] handoff check passed');

    if (hasExplicitHandoffIntent(trimmed)) {
      await applyAnaConversationUpdate(conversationId, {
        classification: 'Handoff',
        lead_temperature: effectiveConv.lead_temperature,
        handoff: true,
      });
      const confirmMsg = 'Entendido! Um atendente vai entrar em contato em breve. Enquanto isso, sua mensagem já foi registrada.';
      const sendResult = await sendTextMessage(toPhoneNumber, confirmMsg);
      if (sendResult.success && sendResult.metaMessageId) {
        await insertMessage(conversationId, 'assistant', confirmMsg, sendResult.metaMessageId);
      }
      return;
    }

    const explicitSwitch = hasExplicitSwitchIntent(trimmed);
    let matched: number | null = null;
    let activeEnterprisesForContext: EnterpriseRow[] | null = null;

    if (explicitSwitch) {
      activeEnterprisesForContext = await listEnterprises(true);
      matched = tryMatchEnterpriseByLastMention(activeEnterprisesForContext, trimmed);
    } else {
      matched = await tryMatchActiveEnterpriseId(trimmed);
    }

    if (matched) {
      const hasCurrentFocus = effectiveConv.enterprise_id != null;
      const isDifferentEnterprise = effectiveConv.enterprise_id !== matched;
      const shouldReclassify = !hasCurrentFocus || (isDifferentEnterprise && explicitSwitch);
      if (shouldReclassify) {
        await setConversationEnterpriseId(conversationId, matched);
        effectiveConv = (await getConversationById(conversationId)) ?? effectiveConv;
      }
    }

    const ent = effectiveConv.enterprise_id ? await getActiveEnterpriseById(effectiveConv.enterprise_id) : null;
    const inactiveLinked = Boolean(effectiveConv.enterprise_id && !ent);

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

    const allEnterpriseNames =
      mode === 'scoped'
        ? (activeEnterprisesForContext ?? (await listEnterprises(true))).map((e) => e.name)
        : [];
    const promptOpts: BuildAnaSystemPromptOpts = {
      mode,
      enterprise: ent,
      variablesMap: vars,
      knowledgeText,
      fileInventory,
      allEnterpriseNames,
    };
    const systemPrompt = buildAnaSystemPrompt(promptOpts);

    const rows = await getMessagesByConversationId(conversationId);
    const history = rowsToHistory(rows, trimmed);

    const messages: ChatMessage[] = [{ role: 'system', content: systemPrompt }];
    for (const h of history) {
      messages.push({ role: h.role, content: h.content });
    }
    messages.push({ role: 'user', content: trimmed });

    const model = aiConfig.modelColdLead || aiConfig.modelHotLead || 'gpt-4o-mini';
    console.log('[ANA DEBUG] building AI context', { mode, model });
    console.log('[ANA DEBUG] calling AI provider', { model });
    const result = await generateChatCompletion({
      apiKey: aiConfig.openaiApiKey,
      baseUrl: aiConfig.openaiBaseUrl,
      model,
      messages,
      // Teto baixo para reduzir invenção de fatos (portfólio/endereço); config do painel ainda aplica-se abaixo do teto.
      temperature: Math.min(Math.max(aiConfig.temperature ?? 0.45, 0), 0.5),
      maxTokens: Math.max(aiConfig.maxTokens ?? 600, 800),
      responseFormatJson: true,
    });

    if (result.success) {
      console.log('[ANA DEBUG] AI response received', { hasContent: !!result.content?.trim() });
    } else {
      console.error('[ANA DEBUG] AI call failed', { error: result.error });
    }

    let structured =
      result.success && result.content ? parseAnaJson(result.content) : null;
    if (!structured && result.success && result.content) {
      structured = fallbackReplyFromRaw(result.content);
    }
    if (!structured) {
      structured = {
        reply: 'Oi — manda de novo em uma linha o que você precisa?',
        classification: 'Novo',
        lead_temperature: null,
        project: ent?.name || '',
        handoff: false,
        customer_name: '',
        summary: result.error || '',
        send_file_category: null,
      };
    }

    const allActiveForGuard = activeEnterprisesForContext ?? (await listEnterprises(true));
    const originEnt = effectiveConv.enterprise_origin_id
      ? await getEnterpriseById(effectiveConv.enterprise_origin_id)
      : null;
    const recentUserTexts = [
      ...rows
        .filter((m) => m.role === 'user')
        .map((m) => (m.content || '').trim())
        .filter((x) => x.length > 0),
      trimmed,
    ].slice(-10);

    const guardResult = validateAnaReply({
      conversationId,
      reply: structured.reply,
      knowledgeText,
      variablesMap: vars,
      activeEnterprise: ent,
      originEnterprise: originEnt,
      userMessage: trimmed,
      recentUserMessages: recentUserTexts,
      allActiveEnterprises: allActiveForGuard,
    });

    if (!guardResult.ok && guardResult.safeReply) {
      logAnaReplyBlocked({
        conversationId,
        reason: guardResult.reason || 'unknown',
        suspiciousSnippet: guardResult.suspiciousSnippet,
      });
      structured = {
        ...structured,
        reply: guardResult.safeReply,
        send_file_category: null,
        project: ent?.name?.trim() ? ent.name.trim() : '',
      };
    }

    await applyAnaConversationUpdate(conversationId, {
      classification: structured.classification,
      lead_temperature: structured.lead_temperature,
      customer_name: structured.customer_name,
      handoff: structured.handoff,
    });

    const replyText = structured.reply.slice(0, 4000);
    console.log('[ANA DEBUG] sending WhatsApp reply', { toPhoneNumber, replyLength: replyText.length });
    const sendResult = await sendTextMessage(toPhoneNumber, replyText);
    if (sendResult.success && sendResult.metaMessageId) {
      await insertMessage(conversationId, 'assistant', replyText, sendResult.metaMessageId);
      console.log('[ANA DEBUG] WhatsApp reply sent', { metaMessageId: sendResult.metaMessageId });
      console.log('[ANA DEBUG] assistant message saved');
    } else {
      console.error('[ANA DEBUG] Falha ao enviar WhatsApp:', sendResult.error, { toPhoneNumber });
    }

    const cat = structured.send_file_category;
    const eid = effectiveConv.enterprise_id;
    if (cat && eid && ent && eid === ent.id) {
      const file = await getFileForSend(eid, cat as FileCategory);
      if (file) {
        const docRes = await sendDocumentMessage(toPhoneNumber, file.path, file.originalName, file.mime, {
          enterpriseId: eid,
          enterpriseName: ent.name,
          conversationId,
          fileCategory: cat,
          enterpriseFileId: file.id,
          relativeStoragePath: file.relativeStoragePath,
          absolutePath: file.path,
        });
        if (docRes.success && docRes.metaMessageId) {
          await logSentFile(conversationId, file.id);
          await insertMessage(
            conversationId,
            'assistant',
            `[Arquivo: ${file.originalName}]`,
            docRes.metaMessageId
          );
          console.log('[ConversationEngine] Arquivo enviado:', file.originalName, 'conv:', conversationId);
        } else {
          console.error('[ConversationEngine] Falha ao enviar documento:', docRes.error, 'conv:', conversationId, 'file:', file.originalName);
          const fallbackText =
            `Não consegui enviar o arquivo "${file.originalName}" pelo WhatsApp neste momento. Peça o material a um atendente ou tente novamente em instantes.`;
          const fixRes = await sendTextMessage(toPhoneNumber, fallbackText);
          if (fixRes.success && fixRes.metaMessageId) {
            await insertMessage(conversationId, 'assistant', fallbackText, fixRes.metaMessageId);
          }
        }
      } else {
        console.warn('[ConversationEngine] Cliente pediu arquivo categoria', cat, 'mas nenhum arquivo encontrado para empreendimento', eid);
      }
    }
  } finally {
    release();
  }
}
