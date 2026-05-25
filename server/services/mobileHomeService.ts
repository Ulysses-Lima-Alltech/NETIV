import type { MobileAuthUser } from './mobileAuthService.js';

type MobileHomeMetric = {
  label: string;
  value: string;
};

type MobileHomeSummary = {
  title: string;
  subtitle: string;
  description: string;
  metrics: MobileHomeMetric[];
  nextActionText: string;
};

export type MobileHomeSummaryResponse = {
  summary: MobileHomeSummary;
};

function getCorretorSummary(user: MobileAuthUser): MobileHomeSummaryResponse {
  return {
    summary: {
      title: 'Bom trabalho hoje',
      subtitle: user.name,
      description: 'Seu painel destaca conversas e visitas que pedem ação imediata.',
      metrics: [
        { label: 'Conversas aguardando', value: '3' },
        { label: 'Visitas hoje', value: '2' },
        { label: 'Precisa de humano', value: '1' },
        { label: 'Leads ativos', value: '12' },
      ],
      nextActionText:
        'Atenda os leads prioritários e acompanhe os casos que já precisam de atendimento humano.',
    },
  };
}

function getGestorSummary(user: MobileAuthUser): MobileHomeSummaryResponse {
  return {
    summary: {
      title: 'Visão do gestor',
      subtitle: user.name,
      description: 'Acompanhe apenas os empreendimentos atribuídos ao seu perfil.',
      metrics: [
        { label: 'Leads nos empreendimentos', value: '41' },
        { label: 'Conversas sem responsável', value: '6' },
        { label: 'Visitas hoje', value: '5' },
        { label: 'Corretores ativos', value: '8' },
      ],
      nextActionText: 'Priorize as conversas sem responsável e mantenha o ritmo comercial da equipe.',
    },
  };
}

function getAdmSummary(user: MobileAuthUser): MobileHomeSummaryResponse {
  return {
    summary: {
      title: 'Painel administrativo',
      subtitle: user.name,
      description: 'Visão geral da operação comercial.',
      metrics: [
        { label: 'Empreendimentos', value: '4' },
        { label: 'Leads abertos', value: '130' },
        { label: 'Conversas totais', value: '820' },
        { label: 'Usuários', value: '24' },
      ],
      nextActionText:
        'Acompanhe a operação geral e acesse o menu administrativo para ajustes.',
    },
  };
}

export function getMobileHomeSummary(user: MobileAuthUser): MobileHomeSummaryResponse {
  if (user.role === 'CORRETOR') return getCorretorSummary(user);
  if (user.role === 'GESTOR') return getGestorSummary(user);
  return getAdmSummary(user);
}
