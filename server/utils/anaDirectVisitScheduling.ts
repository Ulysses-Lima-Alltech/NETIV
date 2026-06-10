import {
  APPOINTMENT_BUSINESS_TZ,
  getJsWeekdayForYmdInSaoPaulo,
  parseAppointmentStartEndInSaoPaulo,
} from './appointmentDateNormalize.js';
import type { CommercialFlowState } from './commercialFlowState.js';
import { extractCustomerNameFromUserUtterance } from './extractCustomerNameFromMessage.js';
import type {
  AnaVisitAvailabilitySlot,
  AnaVisitSlotAvailabilityResult,
} from '../services/anaVisitAvailabilityService.js';

const SP_OFFSET = '-03:00';
export const VISIT_WINDOW_START_MINUTES = 9 * 60;
export const VISIT_WINDOW_END_MINUTES = 18 * 60;
export const VISIT_WINDOW_REPLY = 'Os horários de visita são das 09h às 18h, conforme disponibilidade da agenda.';

const PROHIBITED_VISIT_SCHEDULING_PHRASES = [
  'assim que o corretor confirmar',
  'quando o corretor confirmar',
  'corretor confirmar',
  'confirmar o horario disponivel',
  'vou verificar com o corretor',
  'verificar com o corretor',
  'voce recebe o retorno',
  'recebe o retorno aqui',
  'em breve entraremos em contato',
  'vou sinalizar seu interesse para o plantao',
  'assim que houver disponibilidade',
];

type VisitPeriod = 'manha' | 'tarde' | 'noite';
type VisitSlotKey = 'nome' | 'dia' | 'periodo' | 'horario' | 'empreendimento' | 'telefone';

export interface DirectVisitSchedulingDecision {
  handled: boolean;
  reply: string | null;
  reason: string;
  pendingVisitScheduling: boolean;
  extractedDateLabel: string | null;
  extractedDateYmd: string | null;
  extractedPeriod: VisitPeriod | null;
  extractedTime: string | null;
  capturedSlots: VisitSlotKey[];
  missingSlot: 'nome' | 'dia' | 'periodo_ou_horario' | 'valid_time' | null;
  invalidVisitTime: string | null;
  nextState: CommercialFlowState;
  appointmentConfirmed: boolean;
  appointmentDateYmd: string | null;
  appointmentTimeHm: string | null;
  appointmentBrokerId?: number | null;
}

export interface DirectVisitSchedulingInput {
  userMessage: string;
  flowState: CommercialFlowState;
  confirmationContextKind?:
    | 'visit_confirmation'
    | 'broker_confirmation'
    | 'followup_topic_confirmation'
    | 'media_confirmation'
    | 'ambiguous_confirmation'
    | 'not_short_confirmation'
    | null;
  resolvedIntent?: string | null;
  primaryAxis?: string | null;
  currentAxis?: string | null;
  requestedAxis?: string | null;
  lastAssistantMessage?: string | null;
  enterpriseId: number | null;
  customerName?: string | null;
  customerPhone?: string | null;
  referenceNow?: Date;
  availabilitySuggestion?: AnaVisitAvailabilitySlot | null;
  availabilitySearchCompleted?: boolean;
  suggestedSlotValidation?: AnaVisitSlotAvailabilityResult | null;
  suggestedSlotReplacement?: AnaVisitAvailabilitySlot | null;
  suggestedSlotUnavailable?: boolean;
  exactSlotAvailability?: AnaVisitSlotAvailabilityResult | null;
  exactSlotUnavailableReplacement?: AnaVisitAvailabilitySlot | null;
  exactSlotUnavailable?: boolean;
}

export interface VisitSchedulingContinuationInput {
  userMessage: string;
  lastAssistantMessage?: string | null;
  referenceNow?: Date;
}

export interface VisitSchedulingSlotAnswerInput {
  userMessage: string;
  flowState: CommercialFlowState;
  lastAssistantMessage?: string | null;
  referenceNow?: Date;
}

export interface VisitHistoryMessage {
  role: 'assistant' | 'user';
  content?: string | null;
}

export interface ReconstructedVisitStateResult {
  reconstructed: boolean;
  lowConfidence: boolean;
  reason: string;
  nextState: CommercialFlowState;
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function timeHmToMinutes(timeHm: string): number | null {
  const [hhRaw, mmRaw] = timeHm.split(':');
  const hh = parseInt(hhRaw ?? '', 10);
  const mm = parseInt(mmRaw ?? '', 10);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

function formatYmdInSaoPaulo(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: APPOINTMENT_BUSINESS_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function addDaysYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00${SP_OFFSET}`);
  d.setTime(d.getTime() + days * 86400000);
  return formatYmdInSaoPaulo(d);
}

function nextYmdForWeekday(startYmd: string, targetJsDay: number): string {
  for (let add = 0; add <= 21; add += 1) {
    const ymd = addDaysYmd(startYmd, add);
    if (getJsWeekdayForYmdInSaoPaulo(ymd) === targetJsDay) return ymd;
  }
  return startYmd;
}

function weekdayTokenToJsDay(token: string): number | null {
  const t = norm(token);
  if (t.startsWith('domingo')) return 0;
  if (t.startsWith('segunda')) return 1;
  if (t.startsWith('terca')) return 2;
  if (t.startsWith('quarta')) return 3;
  if (t.startsWith('quinta')) return 4;
  if (t.startsWith('sexta')) return 5;
  if (t.startsWith('sabado')) return 6;
  return null;
}

function parseTimeHmFromText(
  text: string,
  options?: {
    allowStandaloneHour?: boolean;
  }
): string | null {
  const n = norm(text);
  if (options?.allowStandaloneHour === true) {
    const standaloneHour = n.match(/^\s*(\d{1,2})\s*$/);
    if (standaloneHour?.[1]) {
      const hh = parseInt(standaloneHour[1], 10);
      if (hh >= 0 && hh <= 23) return `${pad2(hh)}:00`;
    }
  }
  const reList = [
    /\bas\s+(\d{1,2})(?:h(\d{2})|\s*:\s*(\d{2}))?\b/g,
    /\b(\d{1,2})h(\d{2})\b/g,
    /\b(\d{1,2})h\b/g,
    /\b(\d{1,2}):(\d{2})\b/g,
  ];
  const hits: Array<{ i: number; hm: string }> = [];
  for (const re of reList) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(n)) !== null) {
      const hh = parseInt(m[1] ?? '', 10);
      const mm = m[2] ? parseInt(m[2], 10) : m[3] ? parseInt(m[3], 10) : 0;
      if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) hits.push({ i: m.index, hm: `${pad2(hh)}:${pad2(mm)}` });
    }
  }
  if (hits.length === 0) return null;
  hits.sort((a, b) => a.i - b.i);
  return hits[hits.length - 1]!.hm;
}

function parsePeriodFromText(text: string): VisitPeriod | null {
  const n = norm(text);
  if (!n) return null;
  if (/\b(de manha|de manhã|manha|manhã)\b/.test(n)) return 'manha';
  if (/\b(a tarde|à tarde|de tarde|tarde)\b/.test(n)) return 'tarde';
  if (/\b(a noite|à noite|de noite|noite)\b/.test(n)) return 'noite';
  return null;
}

function extractVisitLotPreference(text: string): string | null {
  const n = norm(text);
  if (!n) return null;

  const hasLocationCue = /\b(perto|proximo|proxima|ao lado|em frente|na frente|colado|proximidade)\b/.test(n);
  if (!hasLocationCue) return null;

  if (/\b(piscina|area de lazer|lazer)\b/.test(n)) return 'perto da piscina/área de lazer';
  if (/\b(quadra|beach tennis|campo society|esportes)\b/.test(n)) return 'perto das áreas esportivas';
  if (/\b(portaria|entrada|acesso)\b/.test(n)) return 'perto da entrada/portaria';

  return 'nessa localização dentro do empreendimento';
}

function assistantAskedLotPreference(text: string | null | undefined): boolean {
  const n = norm(text || '');
  if (!n) return false;

  return /\b(preferencia|preferencia de localizacao|localizacao dentro do empreendimento|localizacao do lote|lote perto|preferencia de lote)\b/.test(n);
}

function normalizeVisitPeriod(value: string | null | undefined): VisitPeriod | null {
  const n = norm(value || '');
  if (!n) return null;
  if (n === 'manha') return 'manha';
  if (n === 'tarde') return 'tarde';
  if (n === 'noite') return 'noite';
  return null;
}

function parseDateMention(text: string, referenceNow: Date): { label: string; ymd: string } | null {
  const n = norm(text);
  const today = formatYmdInSaoPaulo(referenceNow);
  if (/\bdepois de amanha\b/.test(n)) return { label: 'depois de amanhã', ymd: addDaysYmd(today, 2) };
  if (/\bamanha\b/.test(n)) return { label: 'amanhã', ymd: addDaysYmd(today, 1) };
  if (/\bhoje\b/.test(n)) return { label: 'hoje', ymd: today };
  const wd = n.match(/\b(domingo|segunda(?: feira)?|terca(?: feira)?|quarta(?: feira)?|quinta(?: feira)?|sexta(?: feira)?|sabado)\b/);
  if (wd) {
    const jsDay = weekdayTokenToJsDay(wd[1]!);
    if (jsDay != null) return { label: wd[1]!, ymd: nextYmdForWeekday(today, jsDay) };
  }
  return null;
}

export function isVisitSchedulingAckOnlyMessage(text: string): boolean {
  const n = norm(text).replace(/[.,;:!?]+/g, ' ').replace(/\s+/g, ' ').trim();
  return /^(sim|vamos|vamos sim|sim vamos|ok|ta|tá|certo|beleza|perfeito|combinado|aguardo|fico no aguardo|ok aguardo|ok aguardo agendamento|aguardo agendamento|pode ser|pode sim|pode marcar|pode agendar)$/.test(n);
}

export function isExplicitVisitSchedulingAcceptance(text: string): boolean {
  const n = norm(text);
  if (!n) return false;

  if (
    /^(visita|quero visitar|quero visitar la|quero visitar lá|vou visitar|vou visitar entao|vou visitar então|prefiro visita|pode ser a visita|vamos|vamos sim|sim vamos)$/.test(n)
  ) {
    return true;
  }

  return /\b(quero agendar|quero marcar visita|vamos marcar|vamos agendar|pode agendar|pode marcar|quero conhecer o stand|conhecer o stand|visitar o stand|visitar o empreendimento|quero visitar o stand|quero visitar o empreendimento|quero ir visitar|agendar visita|marcar visita)\b/.test(
    n
  );
}

export function isCommercialQuestionThatShouldBypassVisitScheduling(text: string): boolean {
  const n = norm(text);
  if (!n) return false;
  if (extractVisitLotPreference(text) != null) return false;
  return /\b(lote|lotes|tamanho|metragem|valor|preco|parcela|entrada|financiamento|localizacao|endereco|seguranca|camera|cameras|portaria|lazer|condominio|obra|entrega|disponibilidade|tabela|desconto|simulacao|qual|quais|tem|existe|me fala|me manda|nao entendi|vi que)\b/.test(
    n
  );
}

export function isVisitSchedulingSlotAnswer(input: VisitSchedulingSlotAnswerInput): boolean {
  const userMessage = input.userMessage;
  const referenceNow = input.referenceNow ?? new Date();
  if (isExplicitVisitSchedulingAcceptance(userMessage)) return true;
  if (isVisitSchedulingConfirmationMessage(userMessage)) return true;
  if (assistantAskedVisitConfirmation(input.lastAssistantMessage) && isVisitConfirmationShortAckInContext(userMessage)) {
    return true;
  }
  const lastAssistantForSlot = norm(input.lastAssistantMessage || '');
  const assistantAskedVisitSlotContext =
    /\b(para qual dia|qual dia|dia e horario|dia e horário|qual horario|qual horário|horario fica melhor|horário fica melhor|posso confirmar sua visita)\b/.test(
      lastAssistantForSlot
    ) ||
    isAssistantVisitOfferContextMessage(input.lastAssistantMessage);

  const hasPendingVisitSlotContext = input.flowState.pendingVisitScheduling === true;

  const dateMentionForSlotAnswer = parseDateMention(userMessage, referenceNow);
  const timeMentionForSlotAnswer = parseTimeHmFromText(userMessage, { allowStandaloneHour: true });
  const periodMentionForSlotAnswer = parsePeriodFromText(userMessage);

  if (dateMentionForSlotAnswer != null) {
    return hasPendingVisitSlotContext || assistantAskedVisitSlotContext;
  }

  if (timeMentionForSlotAnswer != null) {
    return hasPendingVisitSlotContext || assistantAskedVisitSlotContext;
  }

  if (periodMentionForSlotAnswer != null) {
    if (isLikelyLifestylePeriodAnswer(userMessage, input.lastAssistantMessage)) return false;
    return assistantAskedVisitSlotContext;
  }

  const askedNameByState = input.flowState.pendingVisitMissingSlot === 'nome';
  const askedNameByAssistant = /\b(como posso te chamar|qual seu nome|qual o seu nome|me passa seu nome)\b/.test(
    norm(input.lastAssistantMessage || '')
  );
  if (askedNameByState || askedNameByAssistant) {
    return extractVisitNameFromUserMessage(userMessage) != null;
  }
  return false;
}

function isVisitConfirmationCorrectionMessage(text: string): boolean {
  const n = norm(text).replace(/[.,;:!?]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!n) return false;

  return /^(ja falei que pode|já falei que pode|ja falei pode|já falei pode|ja disse que pode|já disse que pode|ja confirmei|já confirmei|ja falei que sim|já falei que sim|eu ja falei que pode|eu já falei que pode)$/.test(n);
}

function isVisitConfirmationShortAckInContext(text: string): boolean {
  const n = norm(text).replace(/[.,;:!?]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!n) return false;

  return (
    /^(pode|pode sim|sim pode|sim pode sim|claro que pode|pode confirmar|pode confirmar sim)$/.test(n) ||
    isVisitConfirmationCorrectionMessage(text)
  );
}

export function isVisitSchedulingConfirmationMessage(text: string): boolean {
  const n = norm(text).replace(/[.,;:!?]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!n) return false;

  return (
    isVisitSchedulingAckOnlyMessage(text) ||
    /^(sim\s+)?pode\s+confirmar$/.test(n) ||
    /^(sim\s+)?confirma$/.test(n) ||
    /^(sim\s+)?confirmar$/.test(n) ||
    /^confirmo$/.test(n) ||
    /^confirmado$/.test(n) ||
    /^sim\s+confirmado$/.test(n) ||
    /^sim\s+pode\s+confirmar\s+sim$/.test(n)
  );
}

function hasVisitSchedulingWords(text: string): boolean {
  const n = norm(text);
  return /\b(agendar|agendamento|agenda|marcar|visita|visitar|conhecer pessoalmente|conhecer o stand|visitar o stand|visitar o empreendimento|quero visitar|vou visitar)\b/.test(n);
}

export function isVisitSchedulingTopicSwitchMessage(text: string): boolean {
  const n = norm(text);
  if (!n) return false;

  if (extractVisitLotPreference(text) != null) {
    console.log('[ANA_VISIT_LOT_PREFERENCE_NOT_TOPIC_SWITCH]');
    return false;
  }

  if (isVisitSchedulingAckOnlyMessage(text)) return false;
  if (hasVisitSchedulingWords(text)) return false;
  if (parseDateMention(text, new Date())) return false;
  if (parseTimeHmFromText(text, { allowStandaloneHour: true })) return false;
  if (parsePeriodFromText(text)) return false;

  return /\b(valor|preco|preço|parcela|parcelamento|pagamento|entrada|financiamento|lazer|seguranca|segurança|localizacao|localização|endereco|endereço|maps|book|foto|fotos|video|vídeo)\b/.test(
    n
  );
}

export function isVisitSchedulingRefusalMessage(text: string): boolean {
  const n = norm(text);
  if (isVisitConfirmationCorrectionMessage(text)) return false;

  return /\b(nao quero agendar|nao quero visita|nao quero marcar|nao quero horario|nao quero isso|so quero detalhes|quero detalhes|me passa os detalhes|quero saber dos lotes|quero lote plano|lotes planos|ja falei)\b/.test(n);
}

export function isVisitSchedulingLoopFallbackReply(text: string): boolean {
  const n = norm(text);
  return n.includes('so preciso que voce me diga o horario para agendar sua visita');
}

export function isAssistantVisitOfferContextMessage(text: string | null | undefined): boolean {
  const raw = text ?? '';
  const n = norm(raw);
  if (!n || !/\?/.test(raw)) return false;
  const hasVisitWords =
    /\b(agendar|agendamento|marcar|visita|conhecer pessoalmente|reservar horario|reservar horário)\b/.test(n);
  if (!hasVisitWords) return false;
  const asksVisitOffer =
    /\b(quer que eu te ajude a agendar|posso te ajudar a agendar|prefere agendar|vamos marcar|marcar uma visita|agendar uma visita|agendarmos uma visita|agendarmos visita|que tal agendarmos|conhecer pessoalmente)\b/.test(
      n
    );
  const asksVisitSlot =
    /\b(qual dia|para qual dia|dia e horario|dia e horário|qual horario|qual horário|horario fica melhor|horário fica melhor|tenho uma sugestao|tenho uma sugestão|consigo te sugerir|encontrei uma opcao|encontrei uma opção|esse horario funciona|esse horário funciona|fica bom para voce|fica bom para você)\b/.test(
      n
    );
  return asksVisitOffer || asksVisitSlot;
}

function assistantAskedVisitConfirmation(text: string | null | undefined): boolean {
  const n = norm(text || '');
  if (!n) return false;

  return /\b(posso confirmar sua visita|confirmar sua visita|sua visita para|posso deixar sua visita encaminhada|posso seguir com esse horario|posso seguir com esse horário|esse horario funciona|esse horário funciona|funciona para voce|funciona para você|fica bom para voce|fica bom para você)\b/.test(n);
}

function assistantAskedVisitSlotOrOfferContext(text: string | null | undefined): boolean {
  const n = norm(text || '');
  if (!n) return false;

  if (isAssistantVisitOfferContextMessage(text)) return true;
  if (assistantAskedVisitConfirmation(text)) return true;

  return /\b(para qual dia|qual dia|dia e horario|dia e horário|qual periodo|qual período|qual horario|qual horário|horario fica melhor|horário fica melhor|manhã ou tarde|manha ou tarde|tarde ou noite|posso confirmar sua visita)\b/.test(
    n
  );
}

function isLikelyLifestylePeriodAnswer(
  userMessage: string,
  lastAssistantMessage: string | null | undefined
): boolean {
  const n = norm(userMessage);
  const last = norm(lastAssistantMessage || '');

  if (!n || !last) return false;
  if (hasVisitSchedulingWords(userMessage)) return false;
  if (!parsePeriodFromText(userMessage)) return false;

  const periodOnly =
    /\b(fim de tarde|fim da tarde|final de tarde|fim de noite|final de noite|a noite|à noite|de noite|tarde|noite)\b/.test(n) &&
    !parseDateMention(userMessage, new Date()) &&
    !parseTimeHmFromText(userMessage, { allowStandaloneHour: true });

  if (!periodOnly) return false;

  return /\b(o que mais|o que voce|o que você|chamou atencao|chamou atenção|valorizaria|cenario|cenário|ambiente|dia tranquilo|momento ideal|como seria|imagina|descrever|tipo de ambiente)\b/.test(
    last
  );
}

export function isVisitSchedulingIntent(input: DirectVisitSchedulingInput): boolean {
  const explicitVisitAcceptance = isExplicitVisitSchedulingAcceptance(input.userMessage);
  const lotPreferenceContinuation =
    extractVisitLotPreference(input.userMessage) != null &&
    (
      input.flowState.pendingVisitScheduling === true ||
      input.flowState.visitScheduling?.active === true ||
      isAssistantVisitOfferContextMessage(input.lastAssistantMessage) ||
      assistantAskedLotPreference(input.lastAssistantMessage)
    );

  if (lotPreferenceContinuation) return true;

  const slotAnswer = isVisitSchedulingSlotAnswer({
    userMessage: input.userMessage,
    flowState: input.flowState,
    lastAssistantMessage: input.lastAssistantMessage,
    referenceNow: input.referenceNow,
  });
  if (
    isCommercialQuestionThatShouldBypassVisitScheduling(input.userMessage) &&
    !explicitVisitAcceptance &&
    !slotAnswer
  ) {
    return false;
  }
  const axes = [input.resolvedIntent, input.primaryAxis, input.currentAxis, input.requestedAxis]
    .map((x) => norm(String(x ?? '')))
    .filter(Boolean);
  const axisRequestedVisit = axes.some((x) => x === 'visita_agendamento' || x === 'agendar');
  const ackOnlyMessage = isVisitSchedulingAckOnlyMessage(input.userMessage);
  const visitConfirmationMessage = isVisitSchedulingConfirmationMessage(input.userMessage);
  const hasVisitOfferContext = isAssistantVisitOfferContextMessage(input.lastAssistantMessage);
  const assistantAskedConfirmation = assistantAskedVisitConfirmation(input.lastAssistantMessage);
  const ackOnlyMessageAndAssistantAskedConfirmation = ackOnlyMessage && assistantAskedConfirmation;
  if (
    ackOnlyMessageAndAssistantAskedConfirmation ||
    (isVisitConfirmationShortAckInContext(input.userMessage) && assistantAskedConfirmation)
  ) {
    return true;
  }
  const confirmationContextKind = input.confirmationContextKind ?? null;
  const shortConfirmationSuppressesVisit =
    ackOnlyMessage &&
    confirmationContextKind != null &&
    confirmationContextKind !== 'not_short_confirmation' &&
    confirmationContextKind !== 'visit_confirmation';
  const schedulingContinuation = isVisitSchedulingContinuationMessage({
    userMessage: input.userMessage,
    lastAssistantMessage: input.lastAssistantMessage,
    referenceNow: input.referenceNow,
  });
  if (
    input.flowState.pendingVisitScheduling === true &&
    !visitConfirmationMessage &&
    isVisitSchedulingTopicSwitchMessage(input.userMessage)
  ) {
    return false;
  }
  if (input.flowState.pendingVisitScheduling === true) {
    if (slotAnswer) return true;
    if (isLikelyLifestylePeriodAnswer(input.userMessage, input.lastAssistantMessage)) return false;
    if (isCommercialQuestionThatShouldBypassVisitScheduling(input.userMessage) && !explicitVisitAcceptance) return false;
    return true;
  }
  if (shortConfirmationSuppressesVisit) return false;
  if (axisRequestedVisit) {
    if (ackOnlyMessage) return confirmationContextKind === 'visit_confirmation' || hasVisitOfferContext;
    return schedulingContinuation || hasVisitSchedulingWords(input.userMessage);
  }
  if (explicitVisitAcceptance) return true;
  if (hasVisitSchedulingWords(input.userMessage)) return true;
  if (ackOnlyMessage && (confirmationContextKind === 'visit_confirmation' || hasVisitOfferContext)) return true;
  return false;
}

export function isVisitSchedulingContinuationMessage(input: VisitSchedulingContinuationInput): boolean {
  const referenceNow = input.referenceNow ?? new Date();
  const n = norm(input.userMessage);
  if (!n) return false;
  if (/^(obrigado|obrigada|muito obrigado|muito obrigada|ok obrigado|ok obrigada|valeu|vlw|agradeco)[.! ]*$/.test(n)) {
    return true;
  }
  if (/\b(meu nome e|me chamo|pode me chamar de|sou o|sou a|nome)\b/.test(n)) return true;
  if (hasVisitSchedulingWords(input.userMessage)) return true;
  if (parseDateMention(input.userMessage, referenceNow)) return true;
  if (parseTimeHmFromText(input.userMessage)) return true;
  if (
    parsePeriodFromText(input.userMessage) &&
    assistantAskedVisitSlotOrOfferContext(input.lastAssistantMessage) &&
    !isLikelyLifestylePeriodAnswer(input.userMessage, input.lastAssistantMessage)
  ) {
    return true;
  }
  if (
    /\b(dia\s*\d{1,2}|horario|horário|de manha|de manhã|a tarde|à tarde|a noite|à noite|manha|manhã|tarde|noite)\b/.test(n) &&
    assistantAskedVisitSlotOrOfferContext(input.lastAssistantMessage) &&
    !isLikelyLifestylePeriodAnswer(input.userMessage, input.lastAssistantMessage)
  ) {
    return true;
  }
  if (
    isVisitSchedulingAckOnlyMessage(input.userMessage) &&
    isAssistantVisitOfferContextMessage(input.lastAssistantMessage)
  ) {
    return true;
  }
  return false;
}

export function isDirectVisitSchedulingWindow(now: Date = new Date()): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: APPOINTMENT_BUSINESS_TZ,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? '';
  const hour = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '', 10);
  const minute = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '', 10);
  const minutes = hour * 60 + minute;
  void weekday;
  return Number.isFinite(minutes) && minutes >= VISIT_WINDOW_START_MINUTES && minutes <= VISIT_WINDOW_END_MINUTES;
}

export function isAllowedVisitSlot(dateYmd: string, timeHm: string): boolean {
  const parsed = parseAppointmentStartEndInSaoPaulo(dateYmd, timeHm);
  if (!parsed) return false;
  const minutes = timeHmToMinutes(timeHm);
  return minutes != null && minutes >= VISIT_WINDOW_START_MINUTES && minutes <= VISIT_WINDOW_END_MINUTES;
}

export type VisitDateTimeSlotValidation =
  | { valid: true; reason: 'ok'; weekday: number; minutes: number }
  | { valid: false; reason: 'invalid_datetime' | 'outside_visit_window'; weekday: number | null; minutes: number | null };

export function validateVisitDateTimeSlot(dateYmd: string, timeHm: string): VisitDateTimeSlotValidation {
  const parsed = parseAppointmentStartEndInSaoPaulo(dateYmd, timeHm);
  if (!parsed) return { valid: false, reason: 'invalid_datetime', weekday: null, minutes: null };
  const weekday = getJsWeekdayForYmdInSaoPaulo(dateYmd);
  const minutes = timeHmToMinutes(timeHm);
  if (minutes == null) return { valid: false, reason: 'invalid_datetime', weekday, minutes: null };
  if (minutes < VISIT_WINDOW_START_MINUTES || minutes > VISIT_WINDOW_END_MINUTES) {
    return { valid: false, reason: 'outside_visit_window', weekday, minutes };
  }
  return { valid: true, reason: 'ok', weekday, minutes };
}

function displayTimeHm(timeHm: string | null | undefined): string | null {
  const raw = String(timeHm ?? '').trim();
  if (!/^\d{2}:\d{2}$/.test(raw)) return null;
  const hh = Number.parseInt(raw.slice(0, 2), 10);
  const mm = raw.slice(3, 5);
  if (!Number.isFinite(hh)) return null;
  return mm === '00' ? `${hh}h` : `${hh}h${mm}`;
}

function isEmpatheticConfusionMessage(text: string): boolean {
  const n = norm(text);
  if (!n) return false;
  return /^(ue|ueh|u[eé]|como assim|nao entendi|n[aã]o entendi|que|oxi|o que)$/i.test(n);
}

const LOOSE_VISIT_NAME_BLOCKLIST = new Set(
  [
    'sim',
    'nao',
    'ok',
    'claro',
    'pode',
    'amanha',
    'hoje',
    'sabado',
    'domingo',
    'segunda',
    'terca',
    'quarta',
    'quinta',
    'sexta',
    'manha',
    'tarde',
    'noite',
    'horario',
    'visita',
    'vou',
    'quero',
    'visitar',
    'entao',
    'então',
    'la',
    'lá',
    'agendar',
    'mestre',
    'chefe',
    'boss',
    'amigo',
    'parceiro',
    'idolo',
    'kkk',
    'haha',
    'rs',
    'ue',
    'ueh',
    'oxi',
  ].map((token) => token.toLowerCase())
);

function extractLooseVisitNameCandidate(text: string): string | null {
  const raw = String(text || '').trim();
  if (!raw || raw.length < 2 || raw.length > 40) return null;
  if (!/^[A-Za-zÀ-ÿ]+(?:\s+[A-Za-zÀ-ÿ]+){0,2}$/.test(raw)) return null;
  const normalized = norm(raw);
  if (!normalized) return null;

  if (isExplicitVisitSchedulingAcceptance(raw) || hasVisitSchedulingWords(raw)) {
    console.log('[ANA_VISIT_LOOSE_NAME_IGNORED_VISIT_ACCEPTANCE]', {
      raw: raw.slice(0, 80),
    });
    return null;
  }
  if (LOOSE_VISIT_NAME_BLOCKLIST.has(normalized)) return null;
  const words = normalized.split(' ');
  if (words.some((word) => LOOSE_VISIT_NAME_BLOCKLIST.has(word))) return null;
  return raw
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

function periodHumanLabel(period: VisitPeriod | null): string | null {
  if (period === 'manha') return 'de manhã';
  if (period === 'tarde') return 'à tarde';
  if (period === 'noite') return 'à noite';
  return null;
}

function combineDateAndPeriodLabel(dateLabel: string | null, period: VisitPeriod | null): string | null {
  const d = (dateLabel || '').trim();
  const p = periodHumanLabel(period);
  if (d && p) return `${d} ${p}`;
  if (d) return d;
  return p;
}

function askTimeReply(label: string | null): string {
  if (label) return `Perfeito, ${label}. Qual horário fica melhor para você? ${VISIT_WINDOW_REPLY}`;
  return `Perfeito. Qual horário você prefere para a visita? ${VISIT_WINDOW_REPLY}`;
}

function askDayReply(): string {
  return 'Perfeito. Para qual dia você prefere agendar a visita?';
}

function askNameReply(dateLabel: string | null, timeHm: string): string {
  const hh = parseInt(timeHm.slice(0, 2), 10);
  const mm = timeHm.slice(3, 5);
  const displayTime = mm === '00' ? `${hh}h` : `${hh}h${mm}`;
  return `Perfeito, ${dateLabel ?? 'o dia escolhido'} às ${displayTime}. Como posso te chamar para confirmar o agendamento?`;
}

function confirmReply(label: string | null, timeHm: string): string {
  const hh = parseInt(timeHm.slice(0, 2), 10);
  const mm = timeHm.slice(3, 5);
  const displayTime = mm === '00' ? `${hh}h` : `${hh}h${mm}`;
  return `Perfeito, sua visita ficou agendada para ${label ?? 'o dia escolhido'} às ${displayTime}.`;
}

function askVisitConfirmationReply(label: string | null, timeHm: string): string {
  const hh = parseInt(timeHm.slice(0, 2), 10);
  const mm = timeHm.slice(3, 5);
  const displayTime = mm === '00' ? `${hh}h` : `${hh}h${mm}`;
  return `Perfeito. Posso confirmar sua visita para ${label ?? 'o dia escolhido'} às ${displayTime}?`;
}

function buildPendingState(
  prev: CommercialFlowState,
  patch: {
    pending: boolean;
    dateLabel: string | null;
    dateYmd: string | null;
    timeHm?: string | null;
    period?: VisitPeriod | null;
    enterpriseId: number | null;
    invalidTime?: string | null;
    missingSlot?: 'nome' | 'dia' | 'periodo_ou_horario' | 'valid_time' | null;
    customerName?: string | null;
    confirmationAsked?: boolean;
  }
): CommercialFlowState {
  const hasInvalidTimePatch = Object.prototype.hasOwnProperty.call(patch, 'invalidTime');
  const hasMissingSlotPatch = Object.prototype.hasOwnProperty.call(patch, 'missingSlot');
  const hasCustomerNamePatch = Object.prototype.hasOwnProperty.call(patch, 'customerName');
  const hasConfirmationAskedPatch = Object.prototype.hasOwnProperty.call(patch, 'confirmationAsked');
  return {
    ...prev,
    pendingVisitScheduling: patch.pending,
    pendingVisitDateLabel: patch.pending ? patch.dateLabel : null,
    pendingVisitDate: patch.pending ? patch.dateYmd : null,
    pendingVisitDay: patch.pending ? patch.dateLabel : null,
    pendingVisitTime: patch.pending ? (patch.timeHm ?? prev.pendingVisitTime ?? null) : null,
    pendingVisitPeriod: patch.pending ? (patch.period ?? prev.pendingVisitPeriod ?? null) : null,
    pendingVisitEnterpriseId: patch.pending ? patch.enterpriseId : null,
    pendingVisitInvalidTime: patch.pending
      ? hasInvalidTimePatch
        ? (patch.invalidTime ?? null)
        : (prev.pendingVisitInvalidTime ?? null)
      : null,
    pendingVisitMissingSlot: patch.pending
      ? hasMissingSlotPatch
        ? (patch.missingSlot ?? null)
        : (prev.pendingVisitMissingSlot ?? null)
      : null,
    pendingVisitCustomerName: patch.pending
      ? hasCustomerNamePatch
        ? (patch.customerName ?? null)
        : (prev.pendingVisitCustomerName ?? null)
      : null,
    pendingVisitConfirmationAsked: patch.pending
      ? hasConfirmationAskedPatch
        ? Boolean(patch.confirmationAsked)
        : Boolean(prev.pendingVisitConfirmationAsked)
      : false,
    updatedAt: new Date().toISOString(),
  };
}

function suggestedSlotDateLabel(slot: AnaVisitAvailabilitySlot): string {
  return slot.label.split(/\s+às\s+/i)[0]?.trim() || slot.label;
}

function buildSuggestedSlotState(
  prev: CommercialFlowState,
  slot: AnaVisitAvailabilitySlot,
  enterpriseId: number | null,
  customerName: string | null
): CommercialFlowState {
  const dateLabel = suggestedSlotDateLabel(slot);
  return {
    ...prev,
    pendingVisitScheduling: true,
    pendingVisitDateLabel: dateLabel,
    pendingVisitDate: slot.startYmd,
    pendingVisitDay: dateLabel,
    pendingVisitTime: slot.timeHm,
    pendingVisitPeriod: null,
    pendingVisitEnterpriseId: enterpriseId,
    pendingVisitInvalidTime: null,
    pendingVisitMissingSlot: null,
    pendingVisitCustomerName: customerName,
    pendingVisitConfirmationAsked: true,
    suggestedVisitStartAt: slot.startAt.toISOString(),
    suggestedVisitEndAt: slot.endAt.toISOString(),
    suggestedVisitBrokerId: slot.brokerId,
    suggestedVisitSlotLabel: slot.label,
    suggestedVisitTimezone: slot.timezone,
    suggestedVisitStatus: 'awaiting_confirmation',
    visitScheduling: {
      active: true,
      offered: true,
      accepted: false,
      requestedDateText: dateLabel,
      requestedTimeText: displayTimeHm(slot.timeHm),
      requestedPeriodText: null,
      normalizedDate: slot.startYmd,
      normalizedTime: slot.timeHm,
      nameCollected: Boolean((customerName ?? '').trim()),
      customerName,
      status: 'awaiting_slot_confirmation',
    },
    updatedAt: new Date().toISOString(),
  };
}

function clearSuggestedSlotStateAfterAcceptance(
  prev: CommercialFlowState,
  customerName: string | null
): CommercialFlowState {
  return {
    ...prev,
    pendingVisitScheduling: false,
    pendingVisitDateLabel: null,
    pendingVisitDate: null,
    pendingVisitDay: null,
    pendingVisitTime: null,
    pendingVisitPeriod: null,
    pendingVisitEnterpriseId: null,
    pendingVisitInvalidTime: null,
    pendingVisitMissingSlot: null,
    pendingVisitCustomerName: null,
    pendingVisitConfirmationAsked: false,
    suggestedVisitStatus: 'accepted',
    visitScheduling: prev.visitScheduling
      ? {
          ...prev.visitScheduling,
          active: false,
          accepted: true,
          nameCollected: Boolean((customerName ?? '').trim()) || prev.visitScheduling.nameCollected,
          customerName: customerName ?? prev.visitScheduling.customerName ?? null,
          status: 'scheduled',
        }
      : prev.visitScheduling,
    updatedAt: new Date().toISOString(),
  };
}

function pendingSuggestedSlotFromState(state: CommercialFlowState): {
  label: string;
  dateYmd: string;
  timeHm: string;
  startAt: Date;
  endAt: Date;
  brokerId: number | null;
} | null {
  const label = String(state.suggestedVisitSlotLabel ?? '').trim();
  const dateYmd = String(state.pendingVisitDate ?? state.visitScheduling?.normalizedDate ?? '').trim();
  const timeHm = String(state.pendingVisitTime ?? state.visitScheduling?.normalizedTime ?? '').trim();
  const startAtRaw = String(state.suggestedVisitStartAt ?? '').trim();
  const endAtRaw = String(state.suggestedVisitEndAt ?? '').trim();
  if (!label || !dateYmd || !timeHm || !startAtRaw || !endAtRaw) return null;
  const startAt = new Date(startAtRaw);
  const endAt = new Date(endAtRaw);
  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) return null;
  return {
    label,
    dateYmd,
    timeHm,
    startAt,
    endAt,
    brokerId: state.suggestedVisitBrokerId ?? null,
  };
}

function buildInitialSuggestedSlotReply(slot: AnaVisitAvailabilitySlot): string {
  return `Perfeito! Tenho uma sugestão para você: ${slot.label}. Posso deixar sua visita encaminhada nesse horário?`;
}

function buildAlternativeSuggestedSlotReply(slot: AnaVisitAvailabilitySlot): string {
  return `Sem problema. Tenho outra opção para ${slot.label}. Funciona melhor para você?`;
}

function buildUnavailableReplacementReply(slot: AnaVisitAvailabilitySlot): string {
  return `Esse horário acabou ficando indisponível agora. Encontrei outra opção para ${slot.label}. Funciona para você?`;
}

function buildNoImmediateAvailabilityReply(): string {
  return 'Não encontrei um horário disponível imediato por aqui. Posso te colocar com um corretor para verificar uma opção certinha para você?';
}

function isSuggestedSlotChangeRequest(text: string): boolean {
  const n = norm(text);
  if (!n) return false;
  if (isVisitSchedulingConfirmationMessage(text) || isVisitConfirmationShortAckInContext(text)) return false;
  return (
    /\b(nao posso|nao consigo|nao da|n consigo|n da|outro|outra|tem outro|tem outra|melhor|prefiro|pode ser de|so de|s[oó] de|manha|tarde|noite|sabado|domingo|segunda|terca|quarta|quinta|sexta)\b/.test(
      n
    ) ||
    parseDateMention(text, new Date()) != null ||
    parseTimeHmFromText(text, { allowStandaloneHour: true }) != null ||
    parsePeriodFromText(text) != null
  );
}

function knownNameFromContext(input: DirectVisitSchedulingInput): string | null {
  const fromContext = (input.customerName || '').trim();
  if (fromContext.length >= 2) return fromContext;
  const fromFlowState = (input.flowState.pendingVisitCustomerName || '').trim();
  if (fromFlowState.length >= 2) return fromFlowState;
  const fromMessage = extractCustomerNameFromUserUtterance(input.userMessage, {
    lastAssistantPlain: input.lastAssistantMessage ?? null,
  });
  return fromMessage && fromMessage.trim().length >= 2 ? fromMessage.trim() : null;
}

export function handleVisitSchedulingDeterministically(input: DirectVisitSchedulingInput): DirectVisitSchedulingDecision {
  const referenceNow = input.referenceNow ?? new Date();
  const pending = input.flowState.pendingVisitScheduling === true;
  const dateMention = parseDateMention(input.userMessage, referenceNow);
  const timeHm = parseTimeHmFromText(input.userMessage, { allowStandaloneHour: pending });
  const period = parsePeriodFromText(input.userMessage);
  const explicitNameFromMessage =
    extractCustomerNameFromUserUtterance(input.userMessage, {
      lastAssistantPlain: input.lastAssistantMessage ?? null,
    }) || (pending ? extractLooseVisitNameCandidate(input.userMessage) : null);
  const pendingDateLabel = input.flowState.pendingVisitDateLabel ?? null;
  const pendingDateYmd = input.flowState.pendingVisitDate ?? null;
  const pendingTimeHm = input.flowState.pendingVisitTime ?? null;
  const pendingPeriod = normalizeVisitPeriod(input.flowState.pendingVisitPeriod ?? null);
  const pendingInvalidTime = (input.flowState.pendingVisitInvalidTime || '').trim() || null;
  const pendingCustomerName = (input.flowState.pendingVisitCustomerName || '').trim() || null;
  const pendingConfirmationAsked = input.flowState.pendingVisitConfirmationAsked === true;
  const effectiveDateLabel = dateMention?.label ?? pendingDateLabel;
  const effectiveDateYmd = dateMention?.ymd ?? pendingDateYmd;
  const effectiveTimeHm = timeHm ?? pendingTimeHm;
  const shouldClearStalePendingPeriod = Boolean(dateMention && timeHm && !period);
  const effectivePeriod = period ?? (shouldClearStalePendingPeriod ? null : pendingPeriod);
  const effectiveName = explicitNameFromMessage || pendingCustomerName || knownNameFromContext(input);
  const userAckOnly = isVisitSchedulingAckOnlyMessage(input.userMessage);
  const userVisitConfirmation =
    isVisitSchedulingConfirmationMessage(input.userMessage) ||
    (assistantAskedVisitConfirmation(input.lastAssistantMessage) && isVisitConfirmationShortAckInContext(input.userMessage));
  const userConfusion = isEmpatheticConfusionMessage(input.userMessage);
  const visitLotPreference = extractVisitLotPreference(input.userMessage);
  const shouldCaptureVisitLotPreference =
    visitLotPreference != null &&
    !dateMention &&
    !timeHm &&
    !period &&
    (
      pending ||
      isAssistantVisitOfferContextMessage(input.lastAssistantMessage) ||
      assistantAskedLotPreference(input.lastAssistantMessage)
    );
  const pendingSuggestedSlot = pendingSuggestedSlotFromState(input.flowState);
  const awaitingSuggestedSlot =
    pending &&
    pendingSuggestedSlot != null &&
    input.flowState.suggestedVisitStatus === 'awaiting_confirmation';
  const userAcceptedSuggestedSlot = awaitingSuggestedSlot && userVisitConfirmation;
  const userRequestedSuggestedSlotChange =
    awaitingSuggestedSlot && !userAcceptedSuggestedSlot && isSuggestedSlotChangeRequest(input.userMessage);

  const capturedSlots: VisitSlotKey[] = [];
  if (effectiveName) capturedSlots.push('nome');
  if (effectiveDateYmd) capturedSlots.push('dia');
  if (effectivePeriod) capturedSlots.push('periodo');
  const effectiveTimeIsValidForDate =
    effectiveDateYmd && effectiveTimeHm
      ? validateVisitDateTimeSlot(effectiveDateYmd, effectiveTimeHm).valid
      : Boolean(effectiveTimeHm);
  if (effectiveTimeIsValidForDate) capturedSlots.push('horario');
  if (input.enterpriseId != null) capturedSlots.push('empreendimento');
  if ((input.customerPhone || '').replace(/\D/g, '').length >= 10) capturedSlots.push('telefone');

  const finish = (
    reason: string,
    reply: string,
    nextState: CommercialFlowState,
    missingSlot: 'nome' | 'dia' | 'periodo_ou_horario' | 'valid_time' | null,
    appointmentConfirmed = false,
    appointmentDateYmd: string | null = null,
    appointmentTimeHm: string | null = null,
    appointmentBrokerId: number | null = null
  ): DirectVisitSchedulingDecision => ({
    handled: true,
    reply,
    reason,
    nextState,
    pendingVisitScheduling: nextState.pendingVisitScheduling === true,
    extractedDateLabel: dateMention?.label ?? nextState.pendingVisitDateLabel ?? pendingDateLabel,
    extractedDateYmd: dateMention?.ymd ?? nextState.pendingVisitDate ?? pendingDateYmd,
    extractedPeriod: period ?? normalizeVisitPeriod(nextState.pendingVisitPeriod ?? null) ?? pendingPeriod,
    extractedTime: timeHm ?? nextState.pendingVisitTime ?? null,
    capturedSlots,
    missingSlot,
    invalidVisitTime: nextState.pendingVisitInvalidTime ?? null,
    appointmentConfirmed,
    appointmentDateYmd,
    appointmentTimeHm,
    appointmentBrokerId,
  });

  if (userAcceptedSuggestedSlot && pendingSuggestedSlot) {
    const validatedSuggestedBrokerId = input.suggestedSlotValidation?.brokerId ?? null;
    const hasExplicitSuggestedSlotValidation =
      input.suggestedSlotValidation != null &&
      input.suggestedSlotValidation.available === true &&
      validatedSuggestedBrokerId != null;
    if (!hasExplicitSuggestedSlotValidation || input.suggestedSlotUnavailable === true) {
      if (input.suggestedSlotReplacement) {
        const nextState = buildSuggestedSlotState(
          input.flowState,
          input.suggestedSlotReplacement,
          input.enterpriseId,
          effectiveName ?? null
        );
        return finish(
          'suggested_slot_unavailable_replaced',
          buildUnavailableReplacementReply(input.suggestedSlotReplacement),
          nextState,
          null
        );
      }
      const nextState: CommercialFlowState = {
        ...input.flowState,
        suggestedVisitStatus: input.suggestedSlotValidation == null ? 'awaiting_confirmation' : 'expired',
        updatedAt: new Date().toISOString(),
      };
      return finish(
        input.suggestedSlotValidation == null
          ? 'suggested_slot_acceptance_missing_validation'
          : 'suggested_slot_unavailable_no_replacement',
        buildNoImmediateAvailabilityReply(),
        nextState,
        null
      );
    }

    const nextState = clearSuggestedSlotStateAfterAcceptance(input.flowState, effectiveName ?? null);
    return finish(
      'suggested_slot_accepted',
      confirmReply(pendingSuggestedSlot.label.replace(/\s+às\s+.+$/i, ''), pendingSuggestedSlot.timeHm),
      nextState,
      null,
      true,
      pendingSuggestedSlot.dateYmd,
      pendingSuggestedSlot.timeHm,
      validatedSuggestedBrokerId
    );
  }

  if (userRequestedSuggestedSlotChange) {
    if (input.availabilitySuggestion) {
      const nextState = buildSuggestedSlotState(
        input.flowState,
        input.availabilitySuggestion,
        input.enterpriseId,
        effectiveName ?? null
      );
      return finish(
        'suggested_slot_replaced_by_customer_preference',
        buildAlternativeSuggestedSlotReply(input.availabilitySuggestion),
        nextState,
        null
      );
    }
    if (input.exactSlotUnavailableReplacement) {
      const nextState = buildSuggestedSlotState(
        input.flowState,
        input.exactSlotUnavailableReplacement,
        input.enterpriseId,
        effectiveName ?? null
      );
      return finish(
        'requested_slot_unavailable_replaced_after_suggestion',
        buildUnavailableReplacementReply(input.exactSlotUnavailableReplacement),
        nextState,
        null
      );
    }
    if (input.availabilitySearchCompleted === true) {
      const nextState: CommercialFlowState = {
        ...input.flowState,
        suggestedVisitStatus: 'declined',
        updatedAt: new Date().toISOString(),
      };
      return finish(
        'suggested_slot_rejected_no_availability',
        buildNoImmediateAvailabilityReply(),
        nextState,
        null
      );
    }
    const nextState: CommercialFlowState = {
      ...input.flowState,
      suggestedVisitStatus: 'declined',
      updatedAt: new Date().toISOString(),
    };
    return finish(
      'suggested_slot_change_requires_revalidation',
      buildNoImmediateAvailabilityReply(),
      nextState,
      null
    );
  }

  if (!pending && !dateMention && !timeHm && !period) {
    if (input.availabilitySuggestion) {
      const nextState = buildSuggestedSlotState(
        input.flowState,
        input.availabilitySuggestion,
        input.enterpriseId,
        effectiveName ?? null
      );
      return finish(
        'suggested_slot_offered',
        buildInitialSuggestedSlotReply(input.availabilitySuggestion),
        nextState,
        null
      );
    }
    if (input.availabilitySearchCompleted === true) {
      const nextState = buildPendingState(input.flowState, {
        pending: true,
        dateLabel: null,
        dateYmd: null,
        enterpriseId: input.enterpriseId,
        invalidTime: null,
        missingSlot: null,
        customerName: effectiveName ?? null,
        confirmationAsked: false,
      });
      return finish('no_immediate_availability', buildNoImmediateAvailabilityReply(), nextState, null);
    }
  }

  if (
    input.availabilitySuggestion &&
    (effectivePeriod || (effectiveDateYmd && !effectiveTimeHm) || (!effectiveDateYmd && (effectiveTimeHm || effectivePeriod)))
  ) {
    const nextState = buildSuggestedSlotState(
      input.flowState,
      input.availabilitySuggestion,
      input.enterpriseId,
      effectiveName ?? null
    );
    return finish(
      pending ? 'available_slot_suggested_for_customer_preference' : 'suggested_slot_offered_with_preference',
      buildAlternativeSuggestedSlotReply(input.availabilitySuggestion),
      nextState,
      null
    );
  }

  if (shouldCaptureVisitLotPreference) {
    const nextState = buildPendingState(input.flowState, {
      pending: true,
      dateLabel: pendingDateLabel,
      dateYmd: pendingDateYmd,
      timeHm: pendingTimeHm,
      period: pendingPeriod,
      enterpriseId: input.enterpriseId,
      invalidTime: null,
      missingSlot: pendingDateYmd ? 'periodo_ou_horario' : 'dia',
      customerName: effectiveName ?? null,
      confirmationAsked: false,
    });

    const reply = pendingDateYmd
      ? `Anotei sua preferência por ${visitLotPreference}. A disponibilidade de lote específico precisa ser confirmada no atendimento, mas isso ajuda a orientar a visita. Qual horário fica melhor para você? ${VISIT_WINDOW_REPLY}`
      : `Anotei sua preferência por ${visitLotPreference}. A disponibilidade de lote específico precisa ser confirmada no atendimento, mas isso ajuda a orientar a visita. Para qual dia você prefere agendar a visita?`;

    return finish('visit_lot_preference_captured', reply, nextState, pendingDateYmd ? 'periodo_ou_horario' : 'dia');
  }

  if (
    userVisitConfirmation &&
    assistantAskedVisitConfirmation(input.lastAssistantMessage) &&
    !(pendingDateYmd && pendingTimeHm && pendingConfirmationAsked)
  ) {
    const assistantConfirmationDate = parseDateMention(input.lastAssistantMessage || '', referenceNow);
    const assistantConfirmationTime = parseTimeHmFromText(input.lastAssistantMessage || '', {
      allowStandaloneHour: true,
    });

    if (assistantConfirmationDate?.ymd && assistantConfirmationTime) {
      if (input.exactSlotUnavailable === true || input.exactSlotAvailability?.available === false) {
        if (input.exactSlotUnavailableReplacement) {
          const nextState = buildSuggestedSlotState(
            input.flowState,
            input.exactSlotUnavailableReplacement,
            input.enterpriseId,
            effectiveName ?? null
          );
          return finish(
            'reconstructed_confirmation_slot_unavailable_replaced',
            buildUnavailableReplacementReply(input.exactSlotUnavailableReplacement),
            nextState,
            null
          );
        }
        const unavailableState: CommercialFlowState = {
          ...input.flowState,
          suggestedVisitStatus: 'expired',
          updatedAt: new Date().toISOString(),
        };
        return finish(
          'reconstructed_confirmation_slot_unavailable_no_replacement',
          buildNoImmediateAvailabilityReply(),
          unavailableState,
          null
        );
      }
      const confirmationAckState = buildPendingState(input.flowState, {
        pending: false,
        dateLabel: null,
        dateYmd: null,
        timeHm: null,
        period: null,
        enterpriseId: null,
        invalidTime: null,
        missingSlot: null,
        customerName: effectiveName ?? null,
        confirmationAsked: false,
      });

      return finish(
        'assistant_confirmation_ack_reconstructed',
        confirmReply(assistantConfirmationDate.label, assistantConfirmationTime),
        confirmationAckState,
        null,
        true,
        assistantConfirmationDate.ymd,
        assistantConfirmationTime,
        input.exactSlotAvailability?.brokerId ?? null
      );
    }
  }

  if (pending && pendingInvalidTime && !timeHm) {
    const nextState = buildPendingState(input.flowState, {
      pending: true,
      dateLabel: pendingDateLabel,
      dateYmd: pendingDateYmd,
      timeHm: null,
      period: pendingPeriod,
      enterpriseId: input.enterpriseId,
      invalidTime: pendingInvalidTime,
      missingSlot: 'valid_time',
      customerName: effectiveName ?? null,
      confirmationAsked: false,
    });
    if (userConfusion) {
      return finish(
        'invalid_time_pending_confusion_repair',
        `Você tem razão, eu me expressei mal. ${pendingInvalidTime} fica fora do horário disponível para visitas. Consigo seguir com um horário entre 09h e 18h. Qual fica melhor?`,
        nextState,
        'valid_time'
      );
    }
    if (userAckOnly) {
      return finish('invalid_time_pending_ack', 'Certo. Qual horário entre 09h e 18h você prefere?', nextState, 'valid_time');
    }
    if (explicitNameFromMessage) {
      return finish(
        'invalid_time_pending_after_name',
        `Obrigado. Só preciso ajustar o horário: ${pendingInvalidTime} fica fora do período disponível para visitas. Pode ser entre 09h e 18h?`,
        nextState,
        'valid_time'
      );
    }
    return finish(
      'invalid_time_pending_waiting_valid_time',
      'Consigo seguir com um horário entre 09h e 18h. Qual horário você prefere?',
      nextState,
      'valid_time'
    );
  }

  if (!effectiveDateYmd && !effectiveTimeHm && !effectivePeriod) {
    if (!pending) {
      const nextState = buildPendingState(input.flowState, {
        pending: true,
        dateLabel: null,
        dateYmd: null,
        enterpriseId: input.enterpriseId,
        invalidTime: null,
        missingSlot: 'dia',
        customerName: effectiveName ?? null,
        confirmationAsked: false,
      });
      return finish('start_collecting_date', askDayReply(), nextState, 'dia');
    }
    const nextState = buildPendingState(input.flowState, {
      pending: true,
      dateLabel: pendingDateLabel,
      dateYmd: pendingDateYmd,
      timeHm: pendingTimeHm,
      period: pendingPeriod,
      enterpriseId: input.enterpriseId,
      invalidTime: pendingInvalidTime,
      missingSlot: pendingInvalidTime ? 'valid_time' : 'periodo_ou_horario',
      customerName: effectiveName ?? null,
      confirmationAsked: false,
    });
    return finish(
      userAckOnly ? 'pending_without_time_ack' : 'pending_without_time',
      pendingInvalidTime
        ? 'Certo. Qual horário entre 09h e 18h você prefere?'
        : askTimeReply(combineDateAndPeriodLabel(pendingDateLabel, pendingPeriod)),
      nextState,
      pendingInvalidTime ? 'valid_time' : 'periodo_ou_horario'
    );
  }

  if (!effectiveDateYmd && (effectiveTimeHm || effectivePeriod)) {
    const nextState = buildPendingState(input.flowState, {
      pending: true,
      dateLabel: pendingDateLabel,
      dateYmd: pendingDateYmd,
      timeHm: effectiveTimeHm,
      period: effectivePeriod,
      enterpriseId: input.enterpriseId,
      invalidTime: null,
      missingSlot: 'dia',
      customerName: effectiveName ?? null,
      confirmationAsked: false,
    });
    return finish('time_or_period_without_date', askDayReply(), nextState, 'dia');
  }

  if (effectiveDateYmd && !effectiveTimeHm) {
    const nextState = buildPendingState(input.flowState, {
      pending: true,
      dateLabel: effectiveDateLabel,
      dateYmd: effectiveDateYmd,
      timeHm: null,
      period: effectivePeriod,
      enterpriseId: input.enterpriseId,
      invalidTime: null,
      missingSlot: 'periodo_ou_horario',
      customerName: effectiveName ?? null,
      confirmationAsked: false,
    });
    return finish(
      'date_without_time',
      askTimeReply(combineDateAndPeriodLabel(effectiveDateLabel, effectivePeriod)),
      nextState,
      'periodo_ou_horario'
    );
  }

  if (effectiveDateYmd && effectiveTimeHm) {
    const slotValidation = validateVisitDateTimeSlot(effectiveDateYmd, effectiveTimeHm);
    if (!slotValidation.valid) {
      const invalidDisplay = displayTimeHm(effectiveTimeHm) ?? 'esse horário';
      const nextState = buildPendingState(input.flowState, {
        pending: true,
        dateLabel: effectiveDateLabel,
        dateYmd: effectiveDateYmd,
        timeHm: null,
        period: effectivePeriod,
        enterpriseId: input.enterpriseId,
        invalidTime: invalidDisplay,
        missingSlot: 'valid_time',
        customerName: effectiveName ?? null,
        confirmationAsked: false,
      });
      if (pending && !dateMention && !period && timeHm) {
        return finish(
          'time_outside_visit_window_repeat',
          `${invalidDisplay} fica fora do horário de visitas. Posso seguir com um horário entre 09h e 18h. Qual prefere?`,
          nextState,
          'valid_time'
        );
      }
      const label = combineDateAndPeriodLabel(effectiveDateLabel, effectivePeriod);
      const timeWithDate = label ? `${label} às ${invalidDisplay}` : invalidDisplay;
      return finish(
        'time_outside_visit_window',
        `${timeWithDate} fica fora do horário disponível para visitas. ${VISIT_WINDOW_REPLY} Qual horário dentro desse período fica melhor para você?`,
        nextState,
        'valid_time'
      );
    }
    if (input.exactSlotUnavailable === true || input.exactSlotAvailability?.available === false) {
      if (input.exactSlotUnavailableReplacement) {
        const nextState = buildSuggestedSlotState(
          input.flowState,
          input.exactSlotUnavailableReplacement,
          input.enterpriseId,
          effectiveName ?? null
        );
        return finish(
          'requested_slot_unavailable_replaced',
          buildUnavailableReplacementReply(input.exactSlotUnavailableReplacement),
          nextState,
          null
        );
      }
      const nextState = buildPendingState(input.flowState, {
        pending: true,
        dateLabel: effectiveDateLabel,
        dateYmd: effectiveDateYmd,
        timeHm: null,
        period: effectivePeriod,
        enterpriseId: input.enterpriseId,
        invalidTime: null,
        missingSlot: null,
        customerName: effectiveName ?? null,
        confirmationAsked: false,
      });
      return finish('requested_slot_unavailable_no_replacement', buildNoImmediateAvailabilityReply(), nextState, null);
    }
    if (!effectiveName) {
      const nextState = buildPendingState(input.flowState, {
        pending: true,
        dateLabel: effectiveDateLabel,
        dateYmd: effectiveDateYmd,
        timeHm: effectiveTimeHm,
        period: effectivePeriod,
        enterpriseId: input.enterpriseId,
        invalidTime: null,
        missingSlot: 'nome',
        customerName: null,
        confirmationAsked: false,
      });
      return finish(
        'date_time_without_name',
        askNameReply(combineDateAndPeriodLabel(effectiveDateLabel, effectivePeriod), effectiveTimeHm),
        nextState,
        'nome'
      );
    }
    const shouldConfirmNow = pendingConfirmationAsked && userVisitConfirmation;
    if (!shouldConfirmNow) {
      const nextState = buildPendingState(input.flowState, {
        pending: true,
        dateLabel: effectiveDateLabel,
        dateYmd: effectiveDateYmd,
        timeHm: effectiveTimeHm,
        period: effectivePeriod,
        enterpriseId: input.enterpriseId,
        invalidTime: null,
        missingSlot: null,
        customerName: effectiveName,
        confirmationAsked: true,
      });
      return finish(
        'ready_to_confirm_visit',
        askVisitConfirmationReply(combineDateAndPeriodLabel(effectiveDateLabel, effectivePeriod), effectiveTimeHm),
        nextState,
        null
      );
    }
    const nextState = buildPendingState(input.flowState, {
      pending: false,
      dateLabel: null,
      dateYmd: null,
      timeHm: null,
      period: null,
      enterpriseId: null,
      invalidTime: null,
      missingSlot: null,
      customerName: effectiveName,
      confirmationAsked: false,
    });
    return finish(
      'date_and_time_confirmed',
      confirmReply(combineDateAndPeriodLabel(effectiveDateLabel, effectivePeriod), effectiveTimeHm),
      nextState,
      null,
      true,
      effectiveDateYmd,
      effectiveTimeHm,
      input.exactSlotAvailability?.brokerId ?? null
    );
  }

  const nextState = buildPendingState(input.flowState, {
    pending: true,
    dateLabel: pendingDateLabel,
    dateYmd: pendingDateYmd,
    timeHm: pendingTimeHm,
    period: pendingPeriod,
    enterpriseId: input.enterpriseId,
    invalidTime: pendingInvalidTime,
    missingSlot: pendingInvalidTime ? 'valid_time' : 'periodo_ou_horario',
    customerName: effectiveName ?? null,
    confirmationAsked: false,
  });
  return finish(
    'fallback_pending',
    pendingInvalidTime
      ? 'Consigo seguir com um horário entre 09h e 18h. Qual horário você prefere?'
      : askTimeReply(combineDateAndPeriodLabel(pendingDateLabel, pendingPeriod)),
    nextState,
    pendingInvalidTime ? 'valid_time' : 'periodo_ou_horario'
  );
}

function isAssistantVisitFlowCueMessage(text: string): boolean {
  const n = norm(text);
  if (!n) return false;
  return (
    /\b(para qual dia voce prefere agendar a visita|qual horario fica melhor|qual horario entre 09h e 18h|como posso te chamar|posso confirmar sua visita|fic(a|ou) fora do horario|segunda a sabado|agendar a visita)\b/.test(
      n
    ) ||
    isAssistantVisitOfferContextMessage(text)
  );
}

function extractVisitNameFromUserMessage(text: string): string | null {
  return extractCustomerNameFromUserUtterance(text, {
    lastAssistantPlain: 'Como posso te chamar para confirmar o agendamento?',
  }) || extractLooseVisitNameCandidate(text);
}

export function reconstructVisitStateFromRecentMessages(input: {
  recentMessages: VisitHistoryMessage[];
  flowState: CommercialFlowState;
  referenceNow?: Date;
  enterpriseId?: number | null;
  knownCustomerName?: string | null;
}): ReconstructedVisitStateResult {
  if (input.flowState.pendingVisitScheduling === true) {
    return {
      reconstructed: false,
      lowConfidence: false,
      reason: 'already_pending',
      nextState: input.flowState,
    };
  }
  const referenceNow = input.referenceNow ?? new Date();
  const recent = input.recentMessages.slice(-16);
  const assistantMessages = recent
    .filter((m) => m.role === 'assistant')
    .map((m) => String(m.content ?? '').trim())
    .filter((text) => text.length > 0);
  const userMessages = recent
    .filter((m) => m.role === 'user')
    .map((m) => String(m.content ?? '').trim())
    .filter((text) => text.length > 0);

  const cueMessages = assistantMessages.filter((text) => isAssistantVisitFlowCueMessage(text));
  if (cueMessages.length === 0) {
    return {
      reconstructed: false,
      lowConfidence: false,
      reason: 'no_visit_cues',
      nextState: input.flowState,
    };
  }
  const hasStrongAssistantVisitFlowCue = cueMessages.some((text) =>
    /\b(para qual dia voce prefere agendar a visita|qual horario|como posso te chamar|posso confirmar sua visita|fora do horario|09h.*18h)\b/.test(
      norm(text)
    )
  );
  const hasUserSchedulingSignals = userMessages.some(
    (msg) =>
      isExplicitVisitSchedulingAcceptance(msg) ||
      hasVisitSchedulingWords(msg) ||
      parseDateMention(msg, referenceNow) != null ||
      parseTimeHmFromText(msg, { allowStandaloneHour: true }) != null ||
      parsePeriodFromText(msg) != null
  );
  if (!hasUserSchedulingSignals && !hasStrongAssistantVisitFlowCue) {
    return {
      reconstructed: false,
      lowConfidence: false,
      reason: 'assistant_offer_without_user_acceptance',
      nextState: input.flowState,
    };
  }

  let dateLabel: string | null = input.flowState.pendingVisitDateLabel ?? input.flowState.pendingVisitDay ?? null;
  let dateYmd: string | null = input.flowState.pendingVisitDate ?? null;
  let timeHm: string | null = input.flowState.pendingVisitTime ?? null;
  let period: VisitPeriod | null = normalizeVisitPeriod(input.flowState.pendingVisitPeriod ?? null);
  let invalidTime: string | null = (input.flowState.pendingVisitInvalidTime || '').trim() || null;
  let customerName: string | null =
    (input.knownCustomerName || '').trim() ||
    (input.flowState.pendingVisitCustomerName || '').trim() ||
    null;
  let confirmationAsked = input.flowState.pendingVisitConfirmationAsked === true;

  for (const rawUserMessage of userMessages) {
    const dateMention = parseDateMention(rawUserMessage, referenceNow);
    if (dateMention) {
      dateLabel = dateMention.label;
      dateYmd = dateMention.ymd;
    }
    const parsedTime = parseTimeHmFromText(rawUserMessage, { allowStandaloneHour: true });
    if (parsedTime) timeHm = parsedTime;
    const parsedPeriod = parsePeriodFromText(rawUserMessage);
    if (parsedPeriod) period = parsedPeriod;
    const parsedName = extractVisitNameFromUserMessage(rawUserMessage);
    if (parsedName) customerName = parsedName;
    if (isVisitSchedulingAckOnlyMessage(rawUserMessage)) {
      // Mantem estado de confirmação como estava; apenas evita zerar.
      confirmationAsked = confirmationAsked || false;
    }
  }

  for (const rawAssistantMessage of assistantMessages) {
    if (!dateYmd) {
      const assistantDate = parseDateMention(rawAssistantMessage, referenceNow);
      if (assistantDate) {
        dateLabel = assistantDate.label;
        dateYmd = assistantDate.ymd;
      }
    }
    if (!timeHm) {
      const assistantTime = parseTimeHmFromText(rawAssistantMessage, { allowStandaloneHour: true });
      if (assistantTime) timeHm = assistantTime;
    }
    if (!period) {
      const assistantPeriod = parsePeriodFromText(rawAssistantMessage);
      if (assistantPeriod) period = assistantPeriod;
    }
  }

  const lastAssistantMessage = assistantMessages[assistantMessages.length - 1] ?? '';
  const assistantAskedName = /\b(como posso te chamar|qual seu nome|me passa seu nome)\b/.test(norm(lastAssistantMessage));
  const assistantAskedConfirmation = /\b(posso confirmar sua visita)\b/.test(norm(lastAssistantMessage));
  const assistantAskedTime = /\b(qual horario|qual horário)\b/.test(norm(lastAssistantMessage));
  const assistantReportedInvalidTime = /\b(fora do horario|fora do horário|09h.*18h)\b/.test(norm(lastAssistantMessage));

  if (assistantAskedConfirmation) confirmationAsked = true;

  if (dateYmd && timeHm) {
    const slotValidation = validateVisitDateTimeSlot(dateYmd, timeHm);
    if (!slotValidation.valid) {
      invalidTime = displayTimeHm(timeHm) ?? invalidTime ?? 'esse horário';
      timeHm = null;
      confirmationAsked = false;
    } else {
      invalidTime = null;
    }
  }

  if (!invalidTime && assistantReportedInvalidTime) {
    invalidTime = input.flowState.pendingVisitInvalidTime ?? (timeHm ? displayTimeHm(timeHm) : null);
    if (invalidTime) {
      timeHm = null;
      confirmationAsked = false;
    }
  }

  let missingSlot: 'nome' | 'dia' | 'periodo_ou_horario' | 'valid_time' | null = null;
  if (invalidTime) missingSlot = 'valid_time';
  else if (!dateYmd) missingSlot = 'dia';
  else if (!timeHm) missingSlot = 'periodo_ou_horario';
  else if (!customerName || customerName.trim().length < 2) missingSlot = 'nome';

  if (missingSlot === 'nome' && assistantAskedName) {
    confirmationAsked = false;
  }
  if (missingSlot != null && !(assistantAskedConfirmation && missingSlot === 'nome')) confirmationAsked = false;
  if (assistantAskedTime && missingSlot == null && !confirmationAsked) {
    missingSlot = 'periodo_ou_horario';
  }

  const scheduleSignalsFromUser = userMessages.some(
    (msg) =>
      hasVisitSchedulingWords(msg) ||
      parseDateMention(msg, referenceNow) != null ||
      parseTimeHmFromText(msg, { allowStandaloneHour: true }) != null
  );
  const lowConfidence = cueMessages.length < 2 && !scheduleSignalsFromUser;
  const reason = lowConfidence ? 'assistant_visit_prompt_low_confidence' : 'assistant_visit_prompt_detected';

  const reconstructedState = buildPendingState(input.flowState, {
    pending: true,
    dateLabel,
    dateYmd,
    timeHm,
    period,
    enterpriseId: input.enterpriseId ?? input.flowState.pendingVisitEnterpriseId ?? null,
    invalidTime,
    missingSlot,
    customerName: customerName ?? null,
    confirmationAsked,
  });

  return {
    reconstructed: true,
    lowConfidence,
    reason,
    nextState: reconstructedState,
  };
}

export function hasProhibitedVisitSchedulingPhrase(text: string): boolean {
  const n = norm(text);
  return PROHIBITED_VISIT_SCHEDULING_PHRASES.some((phrase) => n.includes(phrase));
}

