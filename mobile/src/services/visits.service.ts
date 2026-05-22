import {
  BROKER_BY_USERNAME,
  MANAGED_ENTERPRISES_BY_GESTOR,
  VISITS_MOCK,
} from "../mocks/visits.mock";
import { AuthUser } from "../types/auth.types";
import { Visit, VisitStatus } from "../types/visit.types";
import { requestJson } from "./api";

function cloneVisit(visit: Visit): Visit {
  return { ...visit };
}

type MobileVisitsResponse = {
  visits: Array<{
    id: string;
    time: string | null;
    clientName: string;
    enterpriseName: string;
    status: string;
    assignedBrokerName: string | null;
  }>;
};

function normalizeVisitStatus(status: string): VisitStatus {
  const normalized = status.trim().toUpperCase();
  if (normalized === "CONFIRMADO" || normalized === "CONFIRMADA") return "Confirmada";
  if (normalized === "REALIZADO" || normalized === "CONCLUIDA" || normalized === "CONCLUIDO") return "Concluida";
  if (normalized === "PENDENTE_CONFIRMACAO") return "Agendada";
  if (normalized === "PENDENTE_DISTRIBUICAO") return "Agendada";
  if (normalized === "CANCELADO") return "Reagendada";
  return "Agendada";
}

function formatVisitTime(rawTime: string | null): string {
  if (!rawTime || !rawTime.trim()) return "--:--";
  const date = new Date(rawTime);
  if (Number.isNaN(date.getTime())) return "--:--";
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function getVisitsByRole(user: AuthUser | null | undefined): Promise<Visit[]> {
  const role = user?.role ?? "CORRETOR";

  if (role === "ADM") {
    return Promise.resolve(VISITS_MOCK.map(cloneVisit));
  }

  if (role === "GESTOR") {
    return Promise.resolve(
      VISITS_MOCK.filter((visit) => MANAGED_ENTERPRISES_BY_GESTOR.includes(visit.enterpriseName)).map(
        cloneVisit
      )
    );
  }

  const usernameKey = user?.username?.trim().toLowerCase() ?? "";
  const brokerName = BROKER_BY_USERNAME[usernameKey] ?? "Joao Corretor";

  return Promise.resolve(
    VISITS_MOCK.filter((visit) => visit.assignedBrokerName === brokerName).map(cloneVisit)
  );
}

export async function getVisitsWithApi(token: string): Promise<Visit[]> {
  const response = await requestJson<MobileVisitsResponse>("/api/mobile/visits", {
    method: "GET",
    token,
  });

  if (!Array.isArray(response?.visits)) {
    throw new Error("INVALID_VISITS_PAYLOAD");
  }

  return response.visits
    .filter((visit) => visit && typeof visit === "object" && typeof visit.id === "string")
    .map((visit) => ({
      id: String(visit.id),
      time: formatVisitTime(visit.time),
      clientName: typeof visit.clientName === "string" && visit.clientName.trim() ? visit.clientName : "Cliente",
      enterpriseName:
        typeof visit.enterpriseName === "string" && visit.enterpriseName.trim()
          ? visit.enterpriseName
          : "Sem empreendimento",
      status: normalizeVisitStatus(typeof visit.status === "string" ? visit.status : "AGENDADA"),
      assignedBrokerName:
        visit.assignedBrokerName !== null && typeof visit.assignedBrokerName !== "string"
          ? null
          : visit.assignedBrokerName ?? null,
    }));
}
