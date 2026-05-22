import { create } from "zustand";

export type UserRole = "CORRETOR" | "GESTOR" | "ADM";

export type AuthUser = {
  id: string;
  username: string;
  name: string;
  role: UserRole;
};

type AuthState = {
  user: AuthUser | null;
  login: (username: string, password: string) => { ok: boolean; message?: string };
  logout: () => void;
};

const MOCK_USERS: Array<AuthUser & { password: string }> = [
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

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  login: (username, password) => {
    const normalizedUsername = username.trim().toLowerCase();
    const normalizedPassword = password.trim();

    const foundUser = MOCK_USERS.find(
      (item) => item.username === normalizedUsername && item.password === normalizedPassword
    );

    if (!foundUser) {
      return {
        ok: false,
        message: "Usuario ou senha invalidos.",
      };
    }

    const { password: _, ...safeUser } = foundUser;
    set({ user: safeUser });

    return { ok: true };
  },
  logout: () => set({ user: null }),
}));
