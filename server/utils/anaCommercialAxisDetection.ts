import { detectCommercialAxes, type CommercialAxis } from './anaCommercialAxisGuard.js';
import { normText } from './anaTextNormalize.js';

export function axisHumanLabel(axis: CommercialAxis): string {
  if (axis === 'metragem_tipologia') return 'metragem';
  if (axis === 'financiamento') return 'formas de pagamento';
  if (axis === 'preco') return 'preco';
  if (axis === 'localizacao') return 'localizacao';
  if (axis === 'lazer') return 'lazer';
  if (axis === 'disponibilidade') return 'disponibilidade';
  if (axis === 'visita_agendamento') return 'visita';
  if (axis === 'intencao_compra') return 'intencao de compra';
  return 'esse ponto';
}

const COMMERCIAL_AXIS_SET: ReadonlySet<CommercialAxis> = new Set<CommercialAxis>([
  'preco',
  'metragem_tipologia',
  'localizacao',
  'lazer',
  'financiamento',
  'disponibilidade',
  'visita_agendamento',
  'intencao_compra',
]);

export function isCommercialAxis(value: unknown): value is CommercialAxis {
  return typeof value === 'string' && COMMERCIAL_AXIS_SET.has(value as CommercialAxis);
}

export function hasLazerSignal(text: string | null | undefined): boolean {
  const n = normText(text || '');
  if (!n) return false;
  return (
    /\blazer\b/.test(n) ||
    /\bamenidades?\b/.test(n) ||
    /\b(area|areas)\s+(de\s+)?lazer\b/.test(n) ||
    /\bareas?\s+comuns?\b/.test(n)
  );
}

export function inferAxisFromAssistantText(text: string | null | undefined): CommercialAxis | null {
  const raw = (text || '').trim();
  if (!raw) return null;
  const detected = detectCommercialAxes(raw);
  if (detected.length > 0) return detected[0] ?? null;
  if (hasLazerSignal(raw) && /\n\s*(?:[-*•]|\d+[.)])\s+/u.test(raw)) {
    return 'lazer';
  }
  return null;
}
