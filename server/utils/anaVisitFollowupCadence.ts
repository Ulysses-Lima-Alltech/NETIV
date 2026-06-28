import type { CommercialFlowState } from './commercialFlowState.js';
import { computeAnaFollowupAtUtc, getAnaFollowupDelayMs } from './anaFollowupCadence.js';

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
  if (attemptIndex < 1) return null;
  const template =
    ANA_VISIT_FOLLOWUP_MESSAGES[Math.min(attemptIndex - 1, ANA_VISIT_FOLLOWUP_MESSAGES.length - 1)] ?? null;
  return template ? renderSuggestedSlotMessage(template, suggestedSlotLabel) : null;
}

export function getAnaVisitFollowupDelayBeforeAttemptMs(attemptIndex: number): number | null {
  return getAnaVisitFollowupOffsetFromAnchorMs(attemptIndex);
}

export function getAnaVisitFollowupOffsetFromAnchorMs(attemptIndex: number): number | null {
  if (!Number.isInteger(attemptIndex)) return null;
  if (attemptIndex < 1) return null;
  return getAnaFollowupDelayMs(attemptIndex);
}

export function computeAnaVisitFollowupNextRunAt(params: {
  anchor: Date;
  nextAttemptIndex: number;
  notBefore?: Date | null;
}): Date | null {
  if (!Number.isInteger(params.nextAttemptIndex) || params.nextAttemptIndex < 1) return null;
  return computeAnaFollowupAtUtc({
    anchor: params.anchor,
    attemptIndex: params.nextAttemptIndex,
    notBefore: params.notBefore ?? null,
  });
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
