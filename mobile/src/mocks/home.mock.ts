import { UserRole } from "../types/auth.types";
import { HomeSummary } from "../types/home.types";

type HomeSummaryTemplate = Omit<HomeSummary, "subtitle">;

export const HOME_SUMMARY_BY_ROLE_MOCK: Record<UserRole, HomeSummaryTemplate> = {
  GESTOR: {
    title: "Visao do gestor",
    description: "Acompanhe apenas os empreendimentos atribuidos ao seu perfil.",
    nextActionText:
      "Priorize as conversas sem responsavel e mantenha o ritmo comercial da equipe.",
    metrics: [
      { label: "Leads nos empreendimentos", value: "41" },
      { label: "Conversas sem responsavel", value: "6" },
      { label: "Visitas hoje", value: "5" },
      { label: "Corretores ativos", value: "8" },
    ],
  },
  ADM: {
    title: "Painel administrativo",
    description: "Visao completa para governanca e performance da operacao.",
    nextActionText:
      "Monitore os indicadores criticos e use o menu administrativo para ajustes rapidos.",
    metrics: [
      { label: "Empreendimentos", value: "4" },
      { label: "Leads abertos", value: "130" },
      { label: "Conversas totais", value: "820" },
      { label: "Usuarios", value: "24" },
    ],
  },
  CORRETOR: {
    title: "Bom trabalho hoje",
    description: "Seu painel destaca conversas e visitas que pedem acao imediata.",
    nextActionText:
      "Atenda os leads prioritarios e acompanhe os casos que ja precisam de atendimento humano.",
    metrics: [
      { label: "Conversas aguardando", value: "3" },
      { label: "Visitas hoje", value: "2" },
      { label: "Precisa de humano", value: "1" },
      { label: "Leads ativos", value: "12" },
    ],
  },
};
