import {
  BROKER_BY_USERNAME,
  MANAGED_ENTERPRISES_BY_GESTOR,
  VISITS_MOCK,
} from "../mocks/visits.mock";
import { AuthUser } from "../types/auth.types";
import { Visit } from "../types/visit.types";

function cloneVisit(visit: Visit): Visit {
  return { ...visit };
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
