/** Alinhado ao backend (`server/constants/reserveSegmentation.ts`). */
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

export const RESERVE_REASON_LABELS: Record<ReserveReason, string> = {
  SEM_INTERESSE_NO_MOMENTO: 'Sem interesse no momento',
  SEM_ORCAMENTO: 'Sem orçamento',
  SEM_RETORNO_3_DIAS: 'Sem retorno (ex.: 3+ dias)',
  AGUARDANDO_MELHOR_MOMENTO: 'Aguardando melhor momento',
  BUSCANDO_OUTRA_CIDADE: 'Buscando outra cidade',
  BUSCANDO_OUTRO_VALOR: 'Buscando outra faixa de valor',
  PERFIL_NAO_COMPATIVEL_AGORA: 'Perfil não compatível agora',
  OUTRO: 'Outro',
};

export const RESERVE_INTEREST_TYPES = ['MORADIA', 'INVESTIMENTO'] as const;

export type ReserveInterestType = (typeof RESERVE_INTEREST_TYPES)[number];

export const RESERVE_INTEREST_LABELS: Record<ReserveInterestType, string> = {
  MORADIA: 'Moradia',
  INVESTIMENTO: 'Investimento',
};
