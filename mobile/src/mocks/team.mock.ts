import { TeamMember } from "../types/team.types";

export const TEAM_MEMBERS_MOCK: TeamMember[] = [
  {
    id: "corretor:1",
    name: "Joao Corretor",
    phone: "(11) 98888-1001",
    role: "CORRETOR",
    active: true,
    mobileAccess: null,
    enterprises: [
      { enterpriseId: "1", enterpriseName: "Evora", manageable: true, label: "Gerenciavel" },
      { enterpriseId: "2", enterpriseName: "Montaresa", manageable: true, label: "Gerenciavel" },
    ],
  },
  {
    id: "corretor:2",
    name: "Mariana Corretora",
    phone: "(11) 98888-1002",
    role: "CORRETOR",
    active: true,
    mobileAccess: null,
    enterprises: [{ enterpriseId: "2", enterpriseName: "Montaresa", manageable: true, label: "Gerenciavel" }],
  },
  {
    id: "corretor:3",
    name: "Lucas Corretor",
    phone: "(11) 98888-1003",
    role: "CORRETOR",
    active: false,
    mobileAccess: null,
    enterprises: [{ enterpriseId: "3", enterpriseName: "Evora II", manageable: false, label: "Somente visualizacao" }],
  },
  {
    id: "mobile:2",
    name: "Gestor Evora",
    phone: "(11) 97777-2001",
    role: "GESTOR",
    active: true,
    mobileAccess: {
      id: "2",
      username: "gestor-evora",
      role: "GESTOR",
      active: true,
    },
    enterprises: [
      { enterpriseId: "1", enterpriseName: "Evora", manageable: true, label: "Gerenciavel" },
      { enterpriseId: "2", enterpriseName: "Montaresa", manageable: true, label: "Gerenciavel" },
    ],
  },
  {
    id: "mobile:3",
    name: "Administrador NETIV",
    phone: "(11) 96666-3001",
    role: "ADM",
    active: true,
    mobileAccess: {
      id: "3",
      username: "admin-netiv",
      role: "ADM",
      active: true,
    },
    enterprises: [
      { enterpriseId: "1", enterpriseName: "Evora", manageable: true, label: "Gerenciavel" },
      { enterpriseId: "2", enterpriseName: "Montaresa", manageable: true, label: "Gerenciavel" },
      { enterpriseId: "3", enterpriseName: "Evora II", manageable: true, label: "Gerenciavel" },
    ],
  },
];
