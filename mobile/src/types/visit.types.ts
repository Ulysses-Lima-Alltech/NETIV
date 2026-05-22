export type VisitStatus = "Confirmada" | "Agendada" | "Reagendada" | "Concluida";

export type Visit = {
  id: string;
  time: string;
  clientName: string;
  enterpriseName: string;
  status: VisitStatus;
  assignedBrokerName: string;
};
