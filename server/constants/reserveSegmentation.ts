/** Motivos padronizados quando classification = Reserva (segmentação / campanhas futuras). */
export const RESERVE_REASONS = [
  'SEM_INTERESSE_NO_MOMENTO',
  'SEM_ORCAMENTO',
  'SEM_RETORNO_3_DIAS',
  'AGUARDANDO_MELHOR_MOMENTO',
  'BUSCANDO_OUTRA_CIDADE',
  'BUSCANDO_OUTRO_VALOR',
  'PERFIL_NAO_COMPATIVEL_AGORA',
  'OUTRO',
] as const;

export type ReserveReason = (typeof RESERVE_REASONS)[number];

export const RESERVE_INTEREST_TYPES = ['MORADIA', 'INVESTIMENTO'] as const;

export type ReserveInterestType = (typeof RESERVE_INTEREST_TYPES)[number];
