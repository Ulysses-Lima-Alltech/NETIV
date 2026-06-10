import type { CommercialFlowState } from './commercialFlowState.js';

export const ANA_VISIT_FOLLOWUP_MAX_ATTEMPT = 10;
export const ANA_VISIT_FOLLOWUP_MIN_GAP_AFTER_SEND_MS = 60_000;

export const ANA_VISIT_FOLLOWUP_MESSAGES: ReadonlyArray<string> = [
  'Só para eu conseguir avançar com sua visita: qual dia e horário fica melhor para você?',
  'Posso te sugerir uma opção? Amanhã ou depois costuma funcionar melhor para você?',
  'Me manda só uma opção de dia e período, tipo manhã, tarde ou fim do dia, que eu já tento organizar por aqui.',
  'Para facilitar: você prefere visitar durante a semana ou no sábado?',
  'Sem problema se ainda estiver vendo. Quando puder, me manda um dia e horário que eu sigo com o agendamento da sua visita.',
  'Oi, passando só para retomar sua visita ao Évora. Quer que eu veja uma opção de horário para você?',
  'Você prefere conhecer o empreendimento em dia de semana ou no sábado?',
  'Posso deixar o corretor responsável aguardando você. Me confirma apenas o melhor dia e horário?',
  'Para facilitar o agendamento, me manda um período que funcione melhor: manhã, tarde ou fim do dia?',
  'Vou deixar por aqui para não te incomodar. Quando quiser, me envie o melhor dia e horário que eu te ajudo com a visita.',
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

export function getAnaVisitFollowupMessage(attemptIndex: number): string | null {
  if (!Number.isInteger(attemptIndex)) return null;
  if (attemptIndex < 1 || attemptIndex > ANA_VISIT_FOLLOWUP_MAX_ATTEMPT) return null;
  return ANA_VISIT_FOLLOWUP_MESSAGES[attemptIndex - 1] ?? null;
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

  const missingSlot = input.missingSlot ?? state.pendingVisitMissingSlot ?? null;
  if (missingSlot === 'dia' || missingSlot === 'periodo_ou_horario' || missingSlot === 'valid_time') {
    return true;
  }
  return replyAsksForVisitDateOrTime(input.replyText);
}
