import { getMessagesByConversationId, getLastUserMessageNeedingReply, insertMessage } from '../repositories/messageRepository.js';
import { getOpenAIConfig } from '../repositories/openaiConfigRepository.js';
import {
  getConversationById,
  setConversationEnterpriseId,
  applyAnaConversationUpdate,
  maxLeadTemperature,
  incrementAnaCustomerNameMentions,
} from '../repositories/conversationRepository.js';
import { sendTextMessage, sendDocumentMessage } from './whatsappMetaService.js';
import {
  tryMatchEnterpriseFromUserCorpus,
  tryMatchEnterpriseAnaphora,
  tryMatchEnterpriseOrdinalFromCatalog,
  tryMatchEnterprisePronounAfterCatalog,
  enterpriseHasStrongNameSignalInTrimmed,
} from '../repositories/enterpriseMatch.js';
import {
  getActiveEnterpriseById,
  loadAgentKnowledgeText,
  listEnterpriseFiles,
  getFileForSend,
  getVariablesMap,
  logSentFile,
  listEnterprises,
  type FileCategory,
  type EnterpriseRow,
} from '../repositories/enterpriseRepository.js';
import { loadRankedKnowledgeChunksForPrompt } from '../repositories/enterpriseKnowledgeChunkRepository.js';
import { isPipelineStale } from './conversationPipelineToken.js';
import { generateChatCompletion, type ChatMessage } from './openaiService.js';
import { resolveEnterpriseLocationContext } from '../utils/anaEnterpriseLocationContext.js';
import { inferRequestedProductType } from '../utils/anaRequestedProductType.js';
import {
  buildAnaSystemPrompt,
  type BuildAnaSystemPromptOpts,
  type CommercialSnapshot,
  pickCommercialListUx,
  parseAnaJson,
  trySalvageStructuredReplyFromRawModelContent,
  fallbackReplyFromRaw,
  detectStrongPurchaseIntentForLeadTemperature,
  buildCatalogFallbackReply,
} from './anaAgentService.js';
import {
  finalizeAnaReplyText,
  countCustomerNameMentionsInText,
  isSimpleOpeningGreeting,
  pickRandomGreetingReply,
  repliesSemanticallySimilar,
  pickDuplicateFallbackReply,
} from '../utils/anaReplyFinalize.js';
import {
  buildUserUtterancesContext,
  computeAppointmentPreflight,
} from '../utils/anaAppointmentIntent.js';
import { extractLeadDataFromConversation } from './leadWalletExtractionService.js';
import { registerAnaAppointmentIfConfirmed } from './anaAppointmentFromChatService.js';
import {
  findOpenAppointmentForConversationAndEnterprise,
  type AppointmentRow,
} from '../repositories/appointmentRepository.js';

/** Modelo principal da Ana (WhatsApp) — saída JSON estruturada. */
const ANA_CHAT_MODEL = 'gpt-5';

function formatOpenAppointmentSummaryForPrompt(row: AppointmentRow, enterpriseName: string): string {
  const fmt = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  const d = row.start_at instanceof Date ? row.start_at : new Date(row.start_at);
  return `Empreendimento: ${enterpriseName}. Visita agendada: ${fmt.format(d)}. Status: ${row.status}.`;
}

/** Garante que a resposta ao cliente cite o mesmo instante gravado no banco. */
function appendCanonicalToReply(reply: string, canonicalLine: string): string {
  const r = (reply || '').trim();
  const core = canonicalLine.replace(/^Registrado no sistema:\s*/i, '').trim();
  if (!core) return reply;
  if (r.toLowerCase().includes(core.slice(0, Math.min(28, core.length)).toLowerCase())) return reply;
  if (!r) return canonicalLine;
  return `${r}\n\n${canonicalLine}`.slice(0, 4000);
}

export interface IncomingMessageContext {
  conversationId: number;
  userMessage: string;
  toPhoneNumber: string;
  /** Rajada WhatsApp: quantas bolhas de usuário no fim do histórico foram fundidas em userMessage (omitir = 1 mensagem isolada). */
  trailingUserBubbles?: number;
  /** Token da janela de debounce; nova mensagem invalida envio pendente. */
  replyPipelineToken?: number;
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
  excludeLastUserText: string | null,
  mergeTrailingUserBubbles?: number
): { role: 'user' | 'assistant'; content: string }[] {
  let list = rows.map((m) => ({
    role: (m.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
    content: (m.content || '').trim(),
  }));
  if (mergeTrailingUserBubbles != null && mergeTrailingUserBubbles > 1) {
    let n = mergeTrailingUserBubbles;
    while (n > 0 && list.length > 0 && list[list.length - 1].role === 'user') {
      list.pop();
      n--;
    }
    if (n > 0) {
      console.warn('[ConversationEngine] mergeTrailingUserBubbles: menos bolhas de usuário no histórico que o esperado', {
        mergeTrailingUserBubbles,
        remaining: n,
      });
    }
  } else if (
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
  'pode me falar', 'pode falar mais do', 'pode falar mais sobre', 'me falar mais do', 'me falar mais sobre',
  'falar mais do', 'falar mais sobre', 'falar do', 'falar sobre',
  'gostaria de saber do', 'gostaria de saber sobre', 'queria saber do', 'queria saber sobre',
  'tenho interesse no', 'tenho interesse em',
  'me passe mais', 'me passe mais informacoes', 'me passe mais informacoes do', 'me passe mais informacoes sobre',
  'me passa mais', 'me passa mais informacoes', 'me passa mais informacoes do', 'me passa mais informacoes sobre',
  'troca para', 'trocar para', 'muda para', 'mudar para',
  'nao quero mais', 'nao gostei desse', 'prefiro o', 'nao me interessa mais',
  'me fala do',
  'me fala sobre',
  'me fale do',
  'me fale sobre',
  'fale do',
  'fale sobre',
  'fala mais do',
  'fala mais sobre',
  'fale mais do',
  'fale mais sobre',
  'me explique',
  'me explica',
  'quero o ',
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
    if (nameNorm.length >= 3) {
      lastIndex = Math.max(lastIndex, tail.lastIndexOf(nameNorm));
    }
    if (slugNorm.length >= 3) {
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

/**
 * Envio de PDF/arquivo após a mensagem de texto — fora do lock da conversa para não bloquear
 * a próxima mensagem do cliente (upload Meta pode levar até ~60s).
 */
async function sendAnaEnterpriseDocumentWhatsApp(params: {
  conversationId: number;
  toPhoneNumber: string;
  ent: EnterpriseRow;
  enterpriseIdForFile: number;
  cat: FileCategory;
}): Promise<void> {
  const { conversationId, toPhoneNumber, ent, enterpriseIdForFile, cat } = params;
  const file = await getFileForSend(enterpriseIdForFile, cat);
  if (!file) {
    console.warn('[DOC_FLOW] skip arquivo: getFileForSend retornou null (async)', { conversationId, category: cat });
    return;
  }
  const docRes = await sendDocumentMessage(toPhoneNumber, file.path, file.originalName, file.mime, {
    enterpriseId: enterpriseIdForFile,
    enterpriseName: ent.name,
    conversationId,
    fileCategory: cat,
    enterpriseFileId: file.id,
    relativeStoragePath: file.relativeStoragePath,
    absolutePath: file.path,
  });
  if (docRes.success && docRes.metaMessageId) {
    await logSentFile(conversationId, file.id);
    await insertMessage(conversationId, 'assistant', `[Arquivo: ${file.originalName}]`, docRes.metaMessageId);
    console.log('[DOC_SEND] documento enviado com sucesso (async)', {
      conversationId,
      metaMessageId: docRes.metaMessageId,
      file: file.originalName,
    });
  } else {
    console.error('[DOC_SEND] falha sendDocumentMessage (async)', {
      conversationId,
      error: docRes.error,
      code: docRes.code,
      file: file.originalName,
    });
    const fallbackText =
      `Não consegui enviar o arquivo "${file.originalName}" pelo WhatsApp neste momento. Peça o material a um atendente ou tente novamente em instantes.`;
    const fixRes = await sendTextMessage(toPhoneNumber, fallbackText);
    if (fixRes.success && fixRes.metaMessageId) {
      await insertMessage(conversationId, 'assistant', fallbackText, fixRes.metaMessageId);
    }
  }
}

const REFINEMENT_PATTERNS = /\b(regiao|região|localizacao|localização|qual\s+regiao|qual\s+região|qual\s+cidade|faixa\s+de\s+investimento|faixa\s+de\s+valor|metragem|qual\s+bairro)\b/i;

/**
 * Detecta loop de refinamento: a Ana perguntou região/faixa nas últimas 2 respostas
 * e o cliente não forneceu a informação (respondeu com "não sei", "me mostra", etc).
 */
function detectRefinementLoop(
  history: { role: 'user' | 'assistant'; content: string }[],
  currentUserMessage: string
): boolean {
  const lastAssistantMsgs = history.filter((h) => h.role === 'assistant').slice(-2);
  if (lastAssistantMsgs.length < 2) return false;
  const bothAskedRefinement = lastAssistantMsgs.every((m) => REFINEMENT_PATTERNS.test(m.content));
  if (!bothAskedRefinement) return false;
  const norm = currentUserMessage.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  const clientDidntAnswer = /\b(nao\s+sei|não\s+sei|me\s+mostr|quero\s+ver|mostra\s+tudo|ver\s+tudo|quero\s+tudo|tanto\s+faz|qualquer|nao\s+tenho|sem\s+prefer)\b/.test(norm)
    || !REFINEMENT_PATTERNS.test(norm);
  return clientDidntAnswer;
}

export async function handleIncomingMessage(ctx: IncomingMessageContext): Promise<void> {
  const { conversationId, userMessage, toPhoneNumber, trailingUserBubbles, replyPipelineToken } = ctx;
  const debugRunId = `run-${Date.now()}-${conversationId}`;
  // #region agent log
  fetch('http://127.0.0.1:7395/ingest/35c3696f-1525-494d-b955-c3b50eb0adf0',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'7815f2'},body:JSON.stringify({sessionId:'7815f2',runId:debugRunId,hypothesisId:'H7',location:'conversationEngine.ts:332',message:'handle_incoming_entry',data:{conversationId,user_len:(userMessage||'').trim().length,toPhone_len:(toPhoneNumber||'').length},timestamp:Date.now()})}).catch(()=>{});
  // #endregion

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
      // #region agent log
      fetch('http://127.0.0.1:7395/ingest/35c3696f-1525-494d-b955-c3b50eb0adf0',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'7815f2'},body:JSON.stringify({sessionId:'7815f2',runId:debugRunId,hypothesisId:'H6',location:'conversationEngine.ts:349',message:'early_return_no_ai_config',data:{conversationId},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      console.error('[ANA DEBUG] getOpenAIConfig retornou null — ignorando mensagem.');
      return;
    }
    if (!aiConfig.openaiApiKey?.trim()) {
      // #region agent log
      fetch('http://127.0.0.1:7395/ingest/35c3696f-1525-494d-b955-c3b50eb0adf0',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'7815f2'},body:JSON.stringify({sessionId:'7815f2',runId:debugRunId,hypothesisId:'H6',location:'conversationEngine.ts:354',message:'early_return_no_openai_key',data:{conversationId,aiEnabled:aiConfig.aiEnabled===true},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      console.warn('[ANA DEBUG] OpenAI API Key não configurada — ignorando mensagem.');
      return;
    }
    if (!aiConfig.aiEnabled) {
      // #region agent log
      fetch('http://127.0.0.1:7395/ingest/35c3696f-1525-494d-b955-c3b50eb0adf0',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'7815f2'},body:JSON.stringify({sessionId:'7815f2',runId:debugRunId,hypothesisId:'H6',location:'conversationEngine.ts:359',message:'early_return_ai_disabled',data:{conversationId,hasOpenAIKey:Boolean(aiConfig.openaiApiKey?.trim())},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
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
      const mergedLeadOnHandoff = maxLeadTemperature(
        effectiveConv.lead_temperature,
        detectStrongPurchaseIntentForLeadTemperature(trimmed) ? 'quente' : null
      );
      await applyAnaConversationUpdate(conversationId, {
        classification: 'Handoff',
        ...(mergedLeadOnHandoff != null ? { lead_temperature: mergedLeadOnHandoff } : {}),
        handoff: true,
      });
      if (isPipelineStale(conversationId, replyPipelineToken)) {
        console.log('[ANA_PIPELINE] cancel_pending_reply', { conversationId, phase: 'handoff_before_send' });
        return;
      }
      const confirmMsg = finalizeAnaReplyText(
        'Entendido! Um atendente vai entrar em contato em breve. Enquanto isso, sua mensagem já foi registrada. Posso te ajudar com mais alguma coisa antes da transferência?'
      );
      const sendResult = await sendTextMessage(toPhoneNumber, confirmMsg);
      if (sendResult.success && sendResult.metaMessageId) {
        await insertMessage(conversationId, 'assistant', confirmMsg, sendResult.metaMessageId);
      }
      return;
    }

    const rows = await getMessagesByConversationId(conversationId);
    let lastUserMessageAt = new Date();
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i].role === 'user') {
        lastUserMessageAt = new Date(rows[i].created_at);
        break;
      }
    }
    const historyForGreeting =
      trailingUserBubbles != null && trailingUserBubbles > 1
        ? rowsToHistory(rows, null, trailingUserBubbles)
        : rowsToHistory(rows, trimmed);

    if (isSimpleOpeningGreeting(trimmed) && historyForGreeting.length === 0) {
      const nm = (effectiveConv.customer_name || '').trim();
      const nameKnown = nm.length >= 2;
      let replyTextGreeting = pickRandomGreetingReply(nameKnown ? nm : null);
      replyTextGreeting = finalizeAnaReplyText(replyTextGreeting).slice(0, 4000);
      if (isPipelineStale(conversationId, replyPipelineToken)) {
        console.log('[ANA_PIPELINE] cancel_pending_reply', { conversationId, phase: 'greeting_before_send' });
        return;
      }
      const freshRows = await getMessagesByConversationId(conversationId);
      const lastAsstG = [...freshRows].reverse().find((m) => m.role === 'assistant');
      if (lastAsstG && (lastAsstG.content || '').trim() === replyTextGreeting.trim()) {
        const ageG = Date.now() - new Date(lastAsstG.created_at).getTime();
        if (ageG < 55_000) {
          replyTextGreeting = 'Como posso te ajudar?';
          console.log('[ANA_PIPELINE] duplicate_greeting_fallback', { conversationId, ageMs: ageG });
        }
      }
      const sendGreeting = await sendTextMessage(toPhoneNumber, replyTextGreeting);
      if (sendGreeting.success && sendGreeting.metaMessageId) {
        await insertMessage(conversationId, 'assistant', replyTextGreeting, sendGreeting.metaMessageId);
        const convAfterG = await getConversationById(conversationId);
        const nameForG = (convAfterG?.customer_name || '').trim();
        const deltaG = countCustomerNameMentionsInText(replyTextGreeting, nameForG);
        if (deltaG > 0) await incrementAnaCustomerNameMentions(conversationId, deltaG);
      }
      return;
    }

    const explicitSwitch = hasExplicitSwitchIntent(trimmed);
    let matched: number | null = null;
    /** De onde veio o match — evita trocar foco por menção antiga em outra bolha. */
    let enterpriseMatchSource:
      | 'current'
      | 'context'
      | 'anaphora'
      | 'pronoun_catalog'
      | 'ordinal'
      | 'explicit_tail'
      | null = null;
    let activeEnterprisesForContext: EnterpriseRow[] | null = null;

    const allActiveEnterprises = await listEnterprises(true);
    const fullUserUtterances = buildUserUtterancesContext(rows);
    const triageRequestedProductType = inferRequestedProductType(trimmed, fullUserUtterances);
    // #region agent log
    fetch('http://127.0.0.1:7395/ingest/35c3696f-1525-494d-b955-c3b50eb0adf0',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'7815f2'},body:JSON.stringify({sessionId:'7815f2',runId:debugRunId,hypothesisId:'H1',location:'conversationEngine.ts:473',message:'pre_match_context',data:{conversationId,trimmed_len:trimmed.length,utterances_len:fullUserUtterances.length,triageRequestedProductType,active_count:allActiveEnterprises.length},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    /** Subconjunto por tipo quando o cliente já manifestou LOTEAMENTO/APARTAMENTO/MCMV; INDEFINIDO = todos (só para resolver localização). */
    const enterprisesForLocationResolution =
      triageRequestedProductType === 'INDEFINIDO'
        ? allActiveEnterprises
        : allActiveEnterprises.filter((e) => e.tipo === triageRequestedProductType);
    const locationQueryContext = resolveEnterpriseLocationContext(
      trimmed,
      fullUserUtterances,
      enterprisesForLocationResolution
    );
    const appointmentPreflight = computeAppointmentPreflight(trimmed, fullUserUtterances);
    /** Com consulta por localização, o match por nome não usa histórico (evita foco errado, ex.: outro empreendimento citado antes). */
    const textForEnterpriseMatch = explicitSwitch
      ? fullUserUtterances.trim() || trimmed
      : locationQueryContext
        ? trimmed
        : fullUserUtterances.trim() || trimmed;

    const matchPool = enterprisesForLocationResolution;
    const lastAssistantRow = [...rows].reverse().find((r) => r.role === 'assistant');
    const lastAssistantText = (lastAssistantRow?.content || '').trim();

    activeEnterprisesForContext = matchPool;

    /**
     * 1) Mensagem atual × todos os ativos — prioridade máxima para troca de foco (ignora filtro de tipo).
     * 2) Mensagem atual × pool (tipo) se ainda vazio.
     * 3) Anáfora / ordinal / pronome / blob de usuário / cauda explicitSwitch.
     */
    const fromGlobalTrimmed = tryMatchEnterpriseFromUserCorpus(trimmed, allActiveEnterprises);
    if (fromGlobalTrimmed != null) {
      matched = fromGlobalTrimmed;
      enterpriseMatchSource = 'current';
    }

    if (matched == null && !locationQueryContext) {
      const fromPoolTrimmed = tryMatchEnterpriseFromUserCorpus(trimmed, matchPool);
      if (fromPoolTrimmed != null) {
        matched = fromPoolTrimmed;
        enterpriseMatchSource = 'current';
      }
    }

    if (matched == null && !locationQueryContext) {
      matched = tryMatchEnterpriseAnaphora(trimmed, lastAssistantText, matchPool);
      if (matched != null) enterpriseMatchSource = 'anaphora';
    }
    if (matched == null && !locationQueryContext) {
      matched = tryMatchEnterpriseOrdinalFromCatalog(trimmed, lastAssistantText, matchPool);
      if (matched != null) enterpriseMatchSource = 'ordinal';
    }
    if (matched == null && !locationQueryContext) {
      matched = tryMatchEnterprisePronounAfterCatalog(trimmed, lastAssistantText, matchPool);
      if (matched != null) enterpriseMatchSource = 'pronoun_catalog';
    }
    if (matched == null && !locationQueryContext) {
      const userBlob = [fullUserUtterances.trim(), trimmed].filter(Boolean).join('\n');
      matched = tryMatchEnterpriseFromUserCorpus(userBlob, matchPool);
      if (matched != null) enterpriseMatchSource = 'context';
    }
    if (matched == null && !locationQueryContext && explicitSwitch) {
      matched = tryMatchEnterpriseByLastMention(matchPool, textForEnterpriseMatch);
      if (matched != null) enterpriseMatchSource = 'explicit_tail';
    }

    if (matched == null && locationQueryContext) {
      const poolTrim = tryMatchEnterpriseFromUserCorpus(trimmed, matchPool);
      if (poolTrim != null) {
        matched = poolTrim;
        enterpriseMatchSource = 'current';
      } else if (explicitSwitch) {
        matched = tryMatchEnterpriseByLastMention(matchPool, textForEnterpriseMatch);
        if (matched != null) enterpriseMatchSource = 'explicit_tail';
      }
    }
    // #region agent log
    fetch('http://127.0.0.1:7395/ingest/35c3696f-1525-494d-b955-c3b50eb0adf0',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'7815f2'},body:JSON.stringify({sessionId:'7815f2',runId:debugRunId,hypothesisId:'H2',location:'conversationEngine.ts:548',message:'post_match_pre_filter',data:{conversationId,location_ctx:Boolean(locationQueryContext),location_ids_count:locationQueryContext?.filteredEnterpriseIds.length??0,matched_enterprise_id:matched,enterpriseMatchSource,explicitSwitch},timestamp:Date.now()})}).catch(()=>{});
    // #endregion

    const strongEnterpriseNameInCurrentMessage =
      matched != null && enterpriseHasStrongNameSignalInTrimmed(matched, trimmed, allActiveEnterprises);
    if (
      matched &&
      locationQueryContext &&
      !locationQueryContext.isEmpty &&
      locationQueryContext.filteredEnterpriseIds.length > 0 &&
      !locationQueryContext.filteredEnterpriseIds.includes(matched) &&
      !strongEnterpriseNameInCurrentMessage
    ) {
      console.log('[ANA_ENTERPRISE_MATCH]', {
        conversationId,
        event: 'location_filter_cleared_match',
        matched_enterprise_id: matched,
        filtered_ids: locationQueryContext.filteredEnterpriseIds,
      });
      matched = null;
      enterpriseMatchSource = null;
    } else if (
      matched &&
      locationQueryContext &&
      !locationQueryContext.isEmpty &&
      locationQueryContext.filteredEnterpriseIds.length > 0 &&
      !locationQueryContext.filteredEnterpriseIds.includes(matched) &&
      strongEnterpriseNameInCurrentMessage
    ) {
      console.log('[ANA_ENTERPRISE_MATCH]', {
        conversationId,
        event: 'location_filter_overridden_by_strong_enterprise_name',
        matched_enterprise_id: matched,
      });
    }
    // #region agent log
    fetch('http://127.0.0.1:7395/ingest/35c3696f-1525-494d-b955-c3b50eb0adf0',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'7815f2'},body:JSON.stringify({sessionId:'7815f2',runId:debugRunId,hypothesisId:'H3',location:'conversationEngine.ts:582',message:'post_location_filter',data:{conversationId,matched_after_location_filter:matched,strongEnterpriseNameInCurrentMessage,location_ctx:Boolean(locationQueryContext),location_empty:locationQueryContext?.isEmpty??null},timestamp:Date.now()})}).catch(()=>{});
    // #endregion

    if (matched != null) {
      const hasFocus = effectiveConv.enterprise_id != null;
      const isDifferent = effectiveConv.enterprise_id !== matched;
      const contextStrongInCurrent =
        enterpriseMatchSource === 'context' &&
        enterpriseHasStrongNameSignalInTrimmed(matched, trimmed, allActiveEnterprises);
      const allowSwitchFromUserPick =
        isDifferent &&
        (enterpriseMatchSource === 'current' ||
          enterpriseMatchSource === 'anaphora' ||
          enterpriseMatchSource === 'pronoun_catalog' ||
          enterpriseMatchSource === 'ordinal' ||
          enterpriseMatchSource === 'explicit_tail' ||
          contextStrongInCurrent);
      const shouldReclassify = !hasFocus || allowSwitchFromUserPick || explicitSwitch;
      let shouldReclassifyReason = 'none';
      if (!hasFocus) shouldReclassifyReason = 'no_previous_focus';
      else if (isDifferent && allowSwitchFromUserPick) {
        shouldReclassifyReason =
          enterpriseMatchSource === 'context' && contextStrongInCurrent
            ? 'switch_context_plus_strong_trimmed_signal'
            : `switch_match_source_${enterpriseMatchSource}`;
      } else if (isDifferent && explicitSwitch) shouldReclassifyReason = 'explicit_switch_phrase';
      else if (!isDifferent) shouldReclassifyReason = 'same_enterprise_as_focus';
      else shouldReclassifyReason = 'keep_focus_match_not_trusted';

      console.log('[ANA_ENTERPRISE_MATCH]', {
        conversationId,
        enterprise_match_current_message: trimmed.slice(0, 240),
        enterprise_match_source: enterpriseMatchSource,
        current_enterprise_id: effectiveConv.enterprise_id ?? null,
        matched_enterprise_id: matched,
        should_reclassify: shouldReclassify,
        should_reclassify_reason: shouldReclassifyReason,
        explicit_switch: explicitSwitch,
        context_strong_in_current: contextStrongInCurrent,
      });

      if (shouldReclassify) {
        await setConversationEnterpriseId(conversationId, matched);
        effectiveConv = (await getConversationById(conversationId)) ?? effectiveConv;
        console.log('[ANA_ENTERPRISE_MATCH]', {
          conversationId,
          event: 'enterprise_focus_updated',
          new_enterprise_id: matched,
        });
      } else {
        console.log('[ANA_ENTERPRISE_MATCH]', {
          conversationId,
          event: 'enterprise_focus_kept',
          kept_enterprise_id: effectiveConv.enterprise_id,
          ignored_match_id: matched,
        });
      }
      // #region agent log
      fetch('http://127.0.0.1:7395/ingest/35c3696f-1525-494d-b955-c3b50eb0adf0',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'7815f2'},body:JSON.stringify({sessionId:'7815f2',runId:debugRunId,hypothesisId:'H4',location:'conversationEngine.ts:636',message:'reclassify_decision',data:{conversationId,matched_enterprise_id:matched,hasFocus,isDifferent,allowSwitchFromUserPick,explicitSwitch,shouldReclassify,current_enterprise_id:effectiveConv.enterprise_id??null},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
    } else {
      console.log('[ANA_ENTERPRISE_MATCH]', {
        conversationId,
        enterprise_match_current_message: trimmed.slice(0, 240),
        enterprise_match_source: null,
        current_enterprise_id: effectiveConv.enterprise_id ?? null,
        matched_enterprise_id: null,
        should_reclassify_reason: 'no_match',
      });
    }

    const ent = effectiveConv.enterprise_id ? await getActiveEnterpriseById(effectiveConv.enterprise_id) : null;
    const inactiveLinked = Boolean(effectiveConv.enterprise_id && !ent);

    let openAppointmentSummary: string | null = null;
    if (ent?.id) {
      const openAppt = await findOpenAppointmentForConversationAndEnterprise(conversationId, ent.id);
      if (openAppt) {
        openAppointmentSummary = formatOpenAppointmentSummaryForPrompt(openAppt, ent.name);
      }
    }

    const richAppointmentContext =
      appointmentPreflight.dateContestation ||
      appointmentPreflight.reschedule ||
      Boolean(openAppointmentSummary?.trim());

    let mode: 'triage' | 'scoped' | 'inactive_linked' = 'triage';
    if (inactiveLinked) mode = 'inactive_linked';
    else if (ent) mode = 'scoped';

    let conversationPhase: NonNullable<BuildAnaSystemPromptOpts['conversationPhase']> = 'triage';
    if (inactiveLinked) conversationPhase = 'inactive';
    else if (appointmentPreflight.active) conversationPhase = 'appointment';
    else if (ent) conversationPhase = 'scoped';
    else if (locationQueryContext) conversationPhase = 'triage_location';
    else if (triageRequestedProductType === 'INDEFINIDO') conversationPhase = 'triage_ask_type';
    else conversationPhase = 'triage_catalog';

    const enterprisesForSameTipoAsEnt =
      ent != null ? allActiveEnterprises.filter((e) => e.tipo === ent.tipo) : [];

    const vars = ent ? await getVariablesMap(ent.id) : {};
    let commercialSnapshots: CommercialSnapshot[] = [];
    /** Com foco scoped, dados e listas devem ser do empreendimento da conversa — não do filtro de cidade antigo no histórico. */
    if (mode === 'scoped' && ent) {
      commercialSnapshots = [{ enterpriseName: ent.name, variables: vars }];
    } else if (locationQueryContext && locationQueryContext.filteredEnterpriseIds.length > 0) {
      const byId = new Map(enterprisesForLocationResolution.map((e) => [e.id, e] as const));
      for (const id of locationQueryContext.filteredEnterpriseIds) {
        const row = byId.get(id);
        if (!row) continue;
        commercialSnapshots.push({ enterpriseName: row.name, variables: await getVariablesMap(id) });
      }
    } else if (ent) {
      commercialSnapshots = [{ enterpriseName: ent.name, variables: vars }];
    }
    const chunkHint = [
      ent?.name && `empreendimento_foco: ${ent.name}`,
      triageRequestedProductType !== 'INDEFINIDO' && `tipo_interesse: ${triageRequestedProductType}`,
      trimmed,
      fullUserUtterances,
    ]
      .filter(Boolean)
      .join('\n')
      .slice(0, 12_000);
    const chunkText = ent ? await loadRankedKnowledgeChunksForPrompt(ent.id, chunkHint) : '';
    const knowledgeBase = ent ? await loadAgentKnowledgeText(ent.id) : '';
    const knowledgeText = [chunkText, knowledgeBase].filter(Boolean).join('\n\n').trim();
    let fileInventory = '';
    if (ent) {
      const files = await listEnterpriseFiles(ent.id);
      fileInventory = files
        .filter((f) => f.is_active && f.can_be_sent_by_ana)
        .map((f) => `${f.category}: ${f.original_name}`)
        .join('; ');
    }
    const hasSendableFiles = fileInventory.trim().length > 0;

    let allEnterpriseNames: string[] = [];
    if (mode === 'scoped' && ent) {
      allEnterpriseNames = (activeEnterprisesForContext ?? enterprisesForSameTipoAsEnt).map((e) => e.name);
    } else if (locationQueryContext) {
      allEnterpriseNames = locationQueryContext.availableEnterprises.map((e) => e.name);
    } else if (mode === 'triage') {
      allEnterpriseNames =
        triageRequestedProductType === 'INDEFINIDO'
          ? []
          : enterprisesForLocationResolution.map((e) => e.name);
    }

    const promptProductTypeForPrompt =
      mode === 'triage'
        ? triageRequestedProductType
        : mode === 'scoped' && ent
          ? ent.tipo
          : undefined;

    const promptOpts: BuildAnaSystemPromptOpts = {
      mode,
      enterprise: ent,
      variablesMap: vars,
      knowledgeText,
      fileInventory,
      allEnterpriseNames,
      requestedProductType: promptProductTypeForPrompt,
      conversationPhase,
      knownCustomerName: effectiveConv.customer_name,
      customerNameMentionsSoFar: effectiveConv.ana_customer_name_mentions ?? 0,
      conversationClassification: effectiveConv.classification,
      appointmentPreflight,
      openAppointmentSummary,
      locationQueryContext:
        mode === 'scoped' && ent ? undefined : (locationQueryContext ?? undefined),
      commercialSnapshots: commercialSnapshots.length > 0 ? commercialSnapshots : undefined,
      commercialListUxHints: commercialSnapshots.length > 1 ? pickCommercialListUx() : undefined,
    };
    // #region agent log
    fetch('http://127.0.0.1:7395/ingest/35c3696f-1525-494d-b955-c3b50eb0adf0',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'7815f2'},body:JSON.stringify({sessionId:'7815f2',runId:debugRunId,hypothesisId:'H5',location:'conversationEngine.ts:766',message:'prompt_mode_snapshot',data:{conversationId,mode,conversationPhase,ent_id:ent?.id??null,ent_name_len:(ent?.name||'').length,location_ctx_sent_to_prompt:Boolean(promptOpts.locationQueryContext),allEnterpriseNames_count:allEnterpriseNames.length,commercialSnapshots_count:commercialSnapshots.length},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    const systemPrompt = buildAnaSystemPrompt(promptOpts);

    const history =
      trailingUserBubbles != null && trailingUserBubbles > 1
        ? rowsToHistory(rows, null, trailingUserBubbles)
        : rowsToHistory(rows, trimmed);

    const recentUserContextForFallback = [...history.filter((h) => h.role === 'user').map((h) => h.content), trimmed]
      .join('\n')
      .slice(-2500);

    const refinementLoopDetected = detectRefinementLoop(history, trimmed);
    let effectiveSystemPrompt = systemPrompt;
    if (refinementLoopDetected && allEnterpriseNames.length > 0 && mode !== 'scoped') {
      const namesList = allEnterpriseNames.slice(0, 5).map((n) => `📍 ${n}`).join('\n');
      effectiveSystemPrompt += `\n\nINSTRUÇÃO DE EMERGÊNCIA — ANTI-LOOP (prioridade absoluta sobre qualquer outra regra de qualificação):
O sistema detectou que você já perguntou região/localização/faixa ao cliente e ele não conseguiu ou não quis responder. NÃO pergunte região/localização/faixa novamente nesta rodada.
Em vez disso, LISTE os empreendimentos disponíveis usando somente nomes reais:
${namesList}${allEnterpriseNames.length > 5 ? '\n(há mais opções)' : ''}
Depois de listar, pergunte qual deles interessa mais. NÃO repita pergunta de região.`;
      console.log('[ANA_PIPELINE] refinement_loop_escape', { conversationId, namesInjected: allEnterpriseNames.length });
    }

    const messages: ChatMessage[] = [{ role: 'system', content: effectiveSystemPrompt }];
    for (const h of history) {
      messages.push({ role: h.role, content: h.content });
    }
    messages.push({ role: 'user', content: trimmed });

    const model = ANA_CHAT_MODEL;
    console.log('[ANA MODEL] modelo_final_selecionado', {
      conversationId,
      model,
      model_used: model,
      mode,
      enterprise: ent?.name ?? null,
      appointmentPreflight: appointmentPreflight.active,
    });
    const result = await generateChatCompletion({
      apiKey: aiConfig.openaiApiKey,
      baseUrl: aiConfig.openaiBaseUrl,
      model,
      messages,
      temperature: Math.min(aiConfig.temperature ?? 0.5, 0.75),
      maxTokens: Math.max(aiConfig.maxTokens ?? 600, 800),
      responseFormatJson: true,
    });

    if (result.success) {
      console.log('[ANA MODEL] resposta_recebida', { conversationId, model, hasContent: !!result.content?.trim() });
      console.log('[ANA_MODEL_OUTPUT]', {
        conversationId,
        raw_model_output_preview: (result.content || '').slice(0, 260),
      });
    } else {
      console.error('[ANA MODEL] chamada_falhou', { conversationId, model, error: result.error });
    }

    let finalReplySource: 'model' | 'salvage' | 'fallback_raw' | 'fallback_structured' = 'model';
    let structured =
      result.success && result.content ? parseAnaJson(result.content) : null;
    console.log('[ANA_PARSE_FLOW]', {
      conversationId,
      parseAnaJson_success: Boolean(structured),
      parseAnaJson_fail: !structured,
    });
    if (!structured && result.success && result.content) {
      structured = trySalvageStructuredReplyFromRawModelContent(result.content);
      if (structured) finalReplySource = 'salvage';
      console.log('[ANA_PARSE_FLOW]', {
        conversationId,
        salvage_success: Boolean(structured),
        salvage_fail: !structured,
      });
    }
    if (!structured && result.success && result.content) {
      console.warn('[DOC_FLOW] parseAnaJson null e sem texto bruto aproveitável — fallbackReplyFromRaw', {
        conversationId,
        contentPreview: result.content.slice(0, 160),
      });
      console.log('[ANA_PARSE_FLOW]', {
        conversationId,
        fallbackReplyFromRaw_used: true,
      });
      finalReplySource = 'fallback_raw';
      structured = fallbackReplyFromRaw(
        result.content,
        trimmed,
        effectiveConv.customer_name,
        appointmentPreflight.active,
        richAppointmentContext,
        recentUserContextForFallback,
        allEnterpriseNames,
        promptProductTypeForPrompt ?? triageRequestedProductType
      );
    }
    if (!structured) {
      const fbReason = !result.success ? 'api_error' : !result.content?.trim() ? 'empty_content' : 'parse_failed';
      console.log('[ANA_PIPELINE] fallback_reply', { conversationId, reason: fbReason });
      console.log('[ANA_PARSE_FLOW]', {
        conversationId,
        structured_fallback_used: true,
      });
      finalReplySource = 'fallback_structured';
      structured = fallbackReplyFromRaw(
        result.content || '',
        trimmed,
        effectiveConv.customer_name,
        appointmentPreflight.active,
        richAppointmentContext,
        recentUserContextForFallback,
        allEnterpriseNames,
        promptProductTypeForPrompt ?? triageRequestedProductType
      );
    }

    if (!hasSendableFiles) {
      structured = { ...structured, send_file_category: null };
    }
    console.log('[ANA_PARSE_FLOW]', {
      conversationId,
      final_reply_source: finalReplySource,
    });

    if (structured) {
      const sr = structured;
      const strongCatalogBlockId = tryMatchEnterpriseFromUserCorpus(trimmed, allActiveEnterprises);
      const blockCatalogInjectionForNamedEnterprise =
        strongCatalogBlockId != null &&
        enterpriseHasStrongNameSignalInTrimmed(strongCatalogBlockId, trimmed, allActiveEnterprises);
      if (
        mode !== 'scoped' &&
        !blockCatalogInjectionForNamedEnterprise &&
        (sr.wantsCatalog || sr.shouldShowPortfolio) &&
        allEnterpriseNames.length > 0 &&
        !allEnterpriseNames.some((n) => sr.reply.includes(n))
      ) {
        const catalogReply = buildCatalogFallbackReply(
          allEnterpriseNames,
          recentUserContextForFallback,
          promptProductTypeForPrompt ?? triageRequestedProductType
        );
        console.log('[ANA_PIPELINE] catalog_injected', { conversationId, namesCount: allEnterpriseNames.length });
        structured = { ...sr, reply: catalogReply };
      }
    }

    const prevClassification = effectiveConv.classification;

    console.log('[DOC_FLOW] structured final (pronto para texto + arquivo)', {
      conversationId,
      mode,
      send_file_category: structured.send_file_category,
      enterprise_id_conv: effectiveConv.enterprise_id,
      ent_id_loaded: ent?.id ?? null,
      ent_name: ent?.name ?? null,
      inactive_linked: inactiveLinked,
    });

    const mergedLeadForAna = maxLeadTemperature(
      effectiveConv.lead_temperature,
      structured.lead_temperature,
      detectStrongPurchaseIntentForLeadTemperature(trimmed) ? 'quente' : null
    );
    await applyAnaConversationUpdate(conversationId, {
      classification: structured.classification,
      ...(mergedLeadForAna != null ? { lead_temperature: mergedLeadForAna } : {}),
      customer_name: structured.customer_name,
      handoff: structured.handoff,
    });

    let replyBody = structured.reply;
    const convForApptRegister = await getConversationById(conversationId);
    if (ent && structured.appointment_confirmed) {
      try {
        const apptRes = await registerAnaAppointmentIfConfirmed({
          conversationId,
          customerName: (convForApptRegister?.customer_name || structured.customer_name || '').trim() || 'Cliente',
          customerPhone: (convForApptRegister?.contact_phone || convForApptRegister?.external_contact_id || '').replace(/\D/g, ''),
          enterpriseId: ent.id,
          city: '',
          appointmentConfirmed: true,
          appointmentDateYmd: structured.appointment_date,
          appointmentTimeHm: structured.appointment_time,
          notes: structured.appointment_notes,
          brokerId: convForApptRegister?.assigned_broker_id ?? null,
          userUtteranceText: fullUserUtterances.trim() || trimmed,
          referenceNow: lastUserMessageAt,
        });
        if (apptRes.persisted && apptRes.canonicalLine) {
          replyBody = appendCanonicalToReply(structured.reply, apptRes.canonicalLine);
        }
      } catch (e) {
        console.error('[ANA APPT]', e);
      }
    }

    if (isPipelineStale(conversationId, replyPipelineToken)) {
      console.log('[ANA_PIPELINE] cancel_pending_reply', { conversationId, phase: 'before_send' });
      return;
    }

    let replyText = finalizeAnaReplyText(replyBody, {
      userMessage: trimmed,
      conversationMode: mode,
    }).slice(0, 4000);
    const rowsBeforeSend = await getMessagesByConversationId(conversationId);
    const lastAsstDup = [...rowsBeforeSend].reverse().find((m) => m.role === 'assistant');
    const lastContent = (lastAsstDup?.content || '').trim();
    const ageDup = lastAsstDup ? Date.now() - new Date(lastAsstDup.created_at).getTime() : Infinity;
    const dupNamePool = mode === 'scoped' ? undefined : allEnterpriseNames;
    if (lastContent && lastContent === replyText.trim() && ageDup < 55_000) {
      console.warn('[ANA_PIPELINE] duplicate_detected_identical', { conversationId, ageMs: ageDup });
      replyText = pickDuplicateFallbackReply(recentUserContextForFallback, dupNamePool);
      console.log('[ANA_PIPELINE] duplicate_fallback_sent', { conversationId, fallbackLen: replyText.length });
    } else if (lastContent && repliesSemanticallySimilar(lastContent, replyText)) {
      console.warn('[ANA_PIPELINE] duplicate_detected_semantic', { conversationId });
      replyText = pickDuplicateFallbackReply(recentUserContextForFallback, dupNamePool);
      console.log('[ANA_PIPELINE] duplicate_fallback_sent', { conversationId, fallbackLen: replyText.length });
    }
    console.log('[ANA_PIPELINE] send_final', { conversationId, toPhoneNumber, replyLength: replyText.length });
    const sendResult = await sendTextMessage(toPhoneNumber, replyText);
    if (sendResult.success && sendResult.metaMessageId) {
      await insertMessage(conversationId, 'assistant', replyText, sendResult.metaMessageId);
      console.log('[ANA DEBUG] WhatsApp reply sent', { metaMessageId: sendResult.metaMessageId });
      console.log('[ANA DEBUG] assistant message saved');
      const convAfterSend = await getConversationById(conversationId);
      const nameForMention = (structured.customer_name?.trim() || convAfterSend?.customer_name || '').trim();
      const delta = countCustomerNameMentionsInText(replyText, nameForMention);
      if (delta > 0) await incrementAnaCustomerNameMentions(conversationId, delta);
    } else {
      console.error('[ANA DEBUG] Falha ao enviar WhatsApp:', sendResult.error, { toPhoneNumber });
    }

    if (structured.classification === 'Carteira' && prevClassification !== 'Carteira') {
      const convRef = await getConversationById(conversationId);
      void extractLeadDataFromConversation(
        conversationId,
        convRef?.customer_name ?? structured.customer_name ?? null,
        ent?.name ?? null
      ).catch((e) => console.error('[Carteira extract]', e));
    }

    const cat = hasSendableFiles ? structured.send_file_category : null;
    /** `ent` já vem de `getActiveEnterpriseById(effectiveConv.enterprise_id)` — usar `ent.id` evita falso negativo se `enterprise_id` da conversa e `ent.id` divergirem por tipo/serialização. */
    const enterpriseIdForFile = ent != null ? Number(ent.id) : null;

    if (!cat) {
      console.log('[DOC_FLOW] skip arquivo: sem send_file_category na resposta estruturada', { conversationId });
    } else if (ent == null || enterpriseIdForFile == null || !Number.isFinite(enterpriseIdForFile)) {
      console.warn('[DOC_FLOW] skip arquivo: empreendimento ativo não resolvido (ANA pediu arquivo)', {
        conversationId,
        cat,
        enterprise_id_conv: effectiveConv.enterprise_id,
        mode,
        inactive_linked: inactiveLinked,
      });
    } else {
      console.log('[DOC_LOOKUP] agendando envio de documento (assíncrono, não bloqueia próxima mensagem)', {
        conversationId,
        enterpriseIdForFile,
        category: cat,
      });
      void sendAnaEnterpriseDocumentWhatsApp({
        conversationId,
        toPhoneNumber,
        ent,
        enterpriseIdForFile,
        cat: cat as FileCategory,
      }).catch((e) => console.error('[DOC_SEND async]', e));
    }
  } finally {
    release();
  }
}
