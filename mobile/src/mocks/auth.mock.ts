import { AuthUser } from "../types/auth.types";

export type AuthMockUser = AuthUser & {
  password: string;
};

export const AUTH_MOCK_USERS: AuthMockUser[] = [
  {
    id: "mock-corretor",
    username: "corretor",
    password: "corretor",
    name: "Corretor Teste",
    role: "CORRETOR",
  },
  {
    id: "mock-gestor",
    username: "gestor",
    password: "gestor",
    name: "Gestor Teste",
    role: "GESTOR",
  },
  {
    id: "mock-admin",
    username: "admin",
    password: "admin",
    name: "Administrador Teste",
    role: "ADM",
  },
];

export const AUTH_MOCK_ACCESS_LIST = [
  "corretor / corretor",
  "gestor / gestor",
  "admin / admin",
];
