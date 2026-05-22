import { Enterprise } from "../types/enterprise.types";

export const MANAGED_ENTERPRISE_NAMES_BY_GESTOR_MOCK = ["Evora", "Montaresa"];

export const ENTERPRISES_MOCK: Enterprise[] = [
  {
    id: "ent-1",
    name: "Evora",
    city: "Sao Paulo",
    active: true,
  },
  {
    id: "ent-2",
    name: "Montaresa",
    city: "Sao Paulo",
    active: true,
  },
  {
    id: "ent-3",
    name: "Altis",
    city: "Campinas",
    active: true,
  },
  {
    id: "ent-4",
    name: "Reserva Azul",
    city: "Santos",
    active: false,
  },
];
