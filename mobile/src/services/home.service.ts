import { ApiRequestError, requestJson } from "./api";
import { AuthUser, UserRole } from "../types/auth.types";
import { HomeSummary } from "../types/home.types";

const FALLBACK_SUMMARY_BY_ROLE: Record<UserRole, Omit<HomeSummary, "subtitle">> = {
  CORRETOR: {
    title: "Painel de atendimento",
    description: "Resumo local temporario enquanto os dados online ficam indisponiveis.",
    nextActionText: "Abra conversas para continuar seu atendimento.",
    metrics: [
      { label: "Conversas ativas", value: "--" },
      { label: "Visitas hoje", value: "--" },
    ],
  },
  GESTOR: {
    title: "Painel de gestao",
    description: "Resumo local temporario enquanto os dados online ficam indisponiveis.",
    nextActionText: "Revise equipe e agenda para manter a operacao fluida.",
    metrics: [
      { label: "Conversas ativas", value: "--" },
      { label: "Visitas da equipe", value: "--" },
    ],
  },
  ADM: {
    title: "Painel administrativo",
    description: "Resumo local temporario enquanto os dados online ficam indisponiveis.",
    nextActionText: "Use o menu superior para acessar as areas administrativas conectadas.",
    metrics: [
      { label: "Conversas ativas", value: "--" },
      { label: "Visitas em andamento", value: "--" },
    ],
  },
};

export function getHomeSummaryByRole(user: AuthUser | null | undefined): Promise<HomeSummary> {
  const role = user?.role ?? "CORRETOR";
  const baseSummary = FALLBACK_SUMMARY_BY_ROLE[role];

  return Promise.resolve({
    ...baseSummary,
    subtitle: user?.name ?? "Usuario",
  });
}

type MobileHomeSummaryResponse = {
  summary: HomeSummary;
};

function isValidSummary(summary: unknown): summary is HomeSummary {
  if (!summary || typeof summary !== "object") return false;

  const parsed = summary as Partial<HomeSummary>;
  if (typeof parsed.title !== "string") return false;
  if (typeof parsed.subtitle !== "string") return false;
  if (typeof parsed.description !== "string") return false;
  if (typeof parsed.nextActionText !== "string") return false;
  if (!Array.isArray(parsed.metrics)) return false;

  return parsed.metrics.every(
    (metric) =>
      Boolean(metric) &&
      typeof metric === "object" &&
      typeof (metric as { label?: unknown }).label === "string" &&
      typeof (metric as { value?: unknown }).value === "string"
  );
}

export async function getHomeSummaryWithApi(token: string): Promise<HomeSummary> {
  const response = await requestJson<MobileHomeSummaryResponse>("/api/mobile/home/summary", {
    method: "GET",
    token,
  });

  if (!isValidSummary(response?.summary)) {
    throw new ApiRequestError("INVALID_SUMMARY_PAYLOAD", 500, response);
  }

  return response.summary;
}
