import { Visit } from "../types/visit.types";

export const MANAGED_ENTERPRISES_BY_GESTOR = ["Evora", "Montaresa"];

export const BROKER_BY_USERNAME: Record<string, string> = {
  corretor: "Joao Corretor",
};

export const VISITS_MOCK: Visit[] = [
  {
    id: "1",
    time: "09:30",
    clientName: "Carlos Silva",
    enterpriseName: "Evora",
    status: "Confirmada",
    assignedBrokerName: "Joao Corretor",
  },
  {
    id: "2",
    time: "14:00",
    clientName: "Mariana Costa",
    enterpriseName: "Montaresa",
    status: "Agendada",
    assignedBrokerName: "Mariana Corretora",
  },
  {
    id: "3",
    time: "17:15",
    clientName: "Rafael Gomes",
    enterpriseName: "Altis",
    status: "Reagendada",
    assignedBrokerName: "Lucas Corretor",
  },
];
