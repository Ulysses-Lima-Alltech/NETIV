import { TeamMember } from "../types/team.types";

export const ALL_ENTERPRISE_NAMES_MOCK = ["Evora", "Montaresa", "Altis", "Reserva Azul"];

export const MANAGED_ENTERPRISES_BY_GESTOR_MOCK = ["Evora", "Montaresa"];

export const TEAM_MEMBERS_MOCK: TeamMember[] = [
  {
    id: "c-1",
    name: "Joao Corretor",
    phone: "(11) 98888-1001",
    role: "CORRETOR",
    active: true,
    enterprises: ["Evora", "Montaresa"],
  },
  {
    id: "c-2",
    name: "Mariana Corretora",
    phone: "(11) 98888-1002",
    role: "CORRETOR",
    active: true,
    enterprises: ["Montaresa"],
  },
  {
    id: "c-3",
    name: "Lucas Corretor",
    phone: "(11) 98888-1003",
    role: "CORRETOR",
    active: false,
    enterprises: ["Altis"],
  },
  {
    id: "g-1",
    name: "Gestor Evora",
    phone: "(11) 97777-2001",
    role: "GESTOR",
    active: true,
    enterprises: ["Evora", "Montaresa"],
  },
  {
    id: "a-1",
    name: "Administrador NETIV",
    phone: "(11) 96666-3001",
    role: "ADM",
    active: true,
    enterprises: ["Evora", "Montaresa", "Altis", "Reserva Azul"],
  },
];
