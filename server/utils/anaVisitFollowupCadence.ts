import type { CommercialFlowState } from './commercialFlowState.js';

export const ANA_VISIT_FOLLOWUP_MAX_ATTEMPT = 10;
export const ANA_VISIT_FOLLOWUP_MIN_GAP_AFTER_SEND_MS = 60_000;

export const ANA_VISIT_FOLLOWUP_MESSAGES: ReadonlyArray<string> = [
  'Só para eu conseguir avançar com sua visita: o horário de {slot} funciona para você?',
  'Esse horário que te sugeri fica bom ou prefere que eu veja outra opção?',
  'Posso tentar outro horário também. Mas consigo seguir com {slot} se funcionar para você.',
  'Para facilitar: quer manter essa sugestão ou prefere outro período, como manhã ou tarde?',
  'Sem problema se ainda estiver vendo. Quando puder, me confirma se esse horário funciona ou se prefere outra opção.',
  'Oi, passando só para retomar sua visita ao Évora. A sugestão de {slot} funciona ou prefere que eu veja outra opção?',
  'Ainda consigo seguir com {slot} se ficar bom para você. Se preferir, também posso buscar outro período.',
  'Quer manter a sugestão de {slot} ou prefere que eu tente outro horário?',
  'Para facilitar o agendamento, posso seguir com {slot} se funcionar. Caso não, vejo outra opção para você.',
  'Vou deixar por aqui para não te incomodar. Quando puder, me confirma se {slot} funciona ou se prefere outra opção.',
];

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

function norm(value: string | null | undefined): string {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function renderSuggestedSlotMessage(template: string, suggestedSlotLabel: string | null | undefined): string {
  const slot = String(suggestedSlotLabel ?? '').trim();
  if (slot) return template.replace(/\{slot\}/g, slot);
  return template.replace(/\s*de\s+\{slot\}/g, '').replace(/\{slot\}/g, 'esse horário');
}

export function getAnaVisitFollowupMessage(
  attemptIndex: number,
  suggestedSlotLabel?: string | null
): string | null {
  if (!Number.isInteger(attemptIndex)) return null;
  if (attemptIndex < 1 || attemptIndex > ANA_VISIT_FOLLOWUP_MAX_ATTEMPT) return null;
  const template = ANA_VISIT_FOLLOWUP_MESSAGES[attemptIndex - 1] ?? null;
  return template ? renderSuggestedSlotMessage(template, suggestedSlotLabel) : null;
}

export function getAnaVisitFollowupDelayBeforeAttemptMs(attemptIndex: number): number | null {
  return getAnaVisitFollowupOffsetFromAnchorMs(attemptIndex);
}

export function getAnaVisitFollowupOffsetFromAnchorMs(attemptIndex: number): number | null {
  if (!Number.isInteger(attemptIndex)) return null;
  if (attemptIndex < 1 || attemptIndex > ANA_VISIT_FOLLOWUP_MAX_ATTEMPT) return null;
  if (attemptIndex <= 5) return attemptIndex * MINUTE_MS;
  return 5 * MINUTE_MS + (attemptIndex - 5) * HOUR_MS;
}

export function computeAnaVisitFollowupNextRunAt(params: {
  anchor: Date;
  nextAttemptIndex: number;
  notBefore?: Date | null;
}): Date | null {
  const offsetMs = getAnaVisitFollowupOffsetFromAnchorMs(params.nextAttemptIndex);
  if (offsetMs == null) return null;
  const anchored = new Date(params.anchor.getTime() + offsetMs);
  const notBefore = params.notBefore ?? null;
  if (notBefore && anchored.getTime() < notBefore.getTime()) return notBefore;
  return anchored;
}

export function replyAsksForVisitDateOrTime(replyText: string): boolean {
  const text = norm(replyText);
  if (!text) return false;
  return (
    /\b(para qual dia|qual dia|dia e horario|dia e hora|dia\/horario|dia\/hora)\b/.test(text) ||
    /\b(qual horario|horario fica melhor|qual periodo|periodo que funcione|semana ou no sabado)\b/.test(text) ||
    /\b(me manda.*dia.*periodo|me confirma.*dia.*horario|mande.*dia.*horario)\b/.test(text)
  );
}

export function replyOffersSuggestedVisitSlot(replyText: string): boolean {
  const text = norm(replyText);
  if (!text) return false;
  return (
    /\b(que tal|tenho uma sugestao|consigo te sugerir|encontrei uma opcao|encontrei um horario disponivel)\b/.test(text) &&
    /\b(funciona|fica bom|posso seguir|posso deixar|visita)\b/.test(text)
  );
}

export function shouldStartAnaVisitFollowup(input: {
  flowState: CommercialFlowState | null | undefined;
  replyText: string;
  missingSlot?: string | null;
}): boolean {
  const state = input.flowState;
  if (!state) return false;
  if (state.pendingVisitScheduling !== true) return false;
  if (state.visitScheduling?.status === 'scheduled') return false;
  if (state.visitScheduling?.active === false && state.pendingVisitScheduling !== true) return false;

  if (
    state.suggestedVisitStatus === 'awaiting_confirmation' &&
    Boolean((state.suggestedVisitSlotLabel ?? '').trim())
  ) {
    return true;
  }

  const missingSlot = input.missingSlot ?? state.pendingVisitMissingSlot ?? null;
  if (missingSlot === 'dia' || missingSlot === 'periodo_ou_horario' || missingSlot === 'valid_time') {
    return true;
  }
  return replyAsksForVisitDateOrTime(input.replyText) || replyOffersSuggestedVisitSlot(input.replyText);
}
