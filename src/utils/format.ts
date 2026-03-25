import type { ConversationStatus } from '../types';

const STATUS_LABELS: Partial<Record<string, string>> = {
  Novo: 'Novo',
  Qualificado: 'Qualificado',
  Carteira: 'Carteira',
  Handoff: 'Handoff',
  NOVO: 'Novo',
  EM_ANDAMENTO: 'Em andamento',
  QUALIFICADO: 'Qualificado',
  HANDOFF: 'Handoff',
};

export function formatStatus(status: ConversationStatus): string {
  const key = String(status);
  if (STATUS_LABELS[key]) return STATUS_LABELS[key]!;
  const s = key.replace(/_/g, ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Segundos → texto legível (ex.: primeira resposta). */
export function formatBrl(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
}

export function formatBrlRange(min: number | null | undefined, max: number | null | undefined): string {
  const a = min != null && Number.isFinite(min) ? min : null;
  const b = max != null && Number.isFinite(max) ? max : null;
  if (a == null && b == null) return '—';
  if (a != null && b != null) return `${formatBrl(a)} a ${formatBrl(b)}`;
  if (a != null) return `desde ${formatBrl(a)}`;
  return `até ${formatBrl(b!)}`;
}

export function formatDurationSeconds(totalSeconds: number | null | undefined): string {
  if (totalSeconds == null || !Number.isFinite(totalSeconds) || totalSeconds < 0) return '—';
  if (totalSeconds < 60) return `${Math.round(totalSeconds)} s`;
  const m = Math.floor(totalSeconds / 60);
  const s = Math.round(totalSeconds % 60);
  if (m < 60) return `${m} min ${s} s`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h} h ${rm} min`;
}

export function formatConversationTime(isoDate: string): string {
  const d = new Date(isoDate);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const msgDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());

  if (msgDate.getTime() === today.getTime()) {
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }
  if (msgDate.getTime() === yesterday.getTime()) {
    return 'Ontem';
  }
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

export function formatMessageTime(isoDate: string): string {
  return new Date(isoDate).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export function formatDateSeparator(isoDate: string): string {
  const d = new Date(isoDate);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const msgDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());

  if (msgDate.getTime() === today.getTime()) return 'Hoje';
  if (msgDate.getTime() === yesterday.getTime()) return 'Ontem';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
