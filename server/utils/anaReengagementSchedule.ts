import { computeAnaFollowupAtUtc } from './anaFollowupCadence.js';

/**
 * Agenda o instante de envio do reengajamento (fuso America/Sao_Paulo).
 *
 * Regras:
 * - earliest = última mensagem do cliente + 13h
 * - target = última mensagem do cliente + 18h (referência de proximidade)
 * - deadline = última mensagem do cliente + 24h (exclusivo: candidatos t < deadline)
 * - Silêncio noturno: proibido entre 22:00 e 06:59:59 (hora local SP); 07:00 em diante permitido
 * - Entre instantes permitidos em [earliest, deadline), escolhe-se o que minimiza |t - target|;
 *   em empate, prefere o instante mais tardio (ex.: 07:00 do dia seguinte vs 21:00 do dia anterior ao target noturno).
 */

const TZ = 'America/Sao_Paulo';
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

function spHourMinute(utcMs: number): { h: number; m: number } {
  const dtf = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = dtf.formatToParts(new Date(utcMs));
  const hp = parts.find((p) => p.type === 'hour')?.value;
  const mp = parts.find((p) => p.type === 'minute')?.value;
  return { h: parseInt(hp ?? '0', 10), m: parseInt(mp ?? '0', 10) };
}

/** 22:00-06:59:59 local SP = proibido; 07:00+ permitido até antes de 22:00. */
export function isForbiddenNightWindowSp(utcMs: number): boolean {
  const { h } = spHourMinute(utcMs);
  return h >= 22 || h < 7;
}

/**
 * Retorna o instante UTC do envio ótimo, ou null se não houver nenhum minuto permitido antes do deadline.
 */
export function computeEligibleReengagementAtUtc(lastUserMessageAt: Date): Date | null {
  const last = lastUserMessageAt.getTime();
  if (Number.isNaN(last)) return null;

  const earliest = last + 13 * HOUR_MS;
  const target = last + 18 * HOUR_MS;
  const deadline = last + 24 * HOUR_MS;

  let bestT: number | null = null;
  let bestDist = Infinity;

  for (let t = earliest; t < deadline; t += MINUTE_MS) {
    if (isForbiddenNightWindowSp(t)) continue;
    const dist = Math.abs(t - target);
    if (dist < bestDist || (dist === bestDist && t > bestT!)) {
      bestT = t;
      bestDist = dist;
    }
  }

  return bestT !== null ? new Date(bestT) : null;
}

/**
 * Verifica se o reengajamento deve ser enviado agora (respeitando janela de 24h e horários permitidos).
 */
export function isReengagementDueNow(lastUserMessageAt: Date, now: Date, eligibleAt: Date | null): boolean {
  if (!eligibleAt) return false;
  const nowMs = now.getTime();
  const lastMs = lastUserMessageAt.getTime();
  const deadlineMs = lastMs + 24 * HOUR_MS;
  
  // Não enviar se já passou do deadline (24h)
  if (nowMs >= deadlineMs) return false;
  
  // Não enviar se ainda não atingiu o horário elegível
  if (nowMs < eligibleAt.getTime()) return false;
  
  // Não enviar se estiver em janela noturna proibida
  if (isForbiddenNightWindowSp(nowMs)) return false;
  
  return true;
}

export function computeCommercialFollowupEligibleAtUtc(lastAnaMessageAt: Date, cycleCount: number): Date | null {
  if (!Number.isInteger(cycleCount) || cycleCount < 0) return null;
  return computeAnaFollowupAtUtc({
    anchor: lastAnaMessageAt,
    attemptIndex: cycleCount + 1,
  });
}
