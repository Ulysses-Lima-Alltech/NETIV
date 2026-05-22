import { create } from "zustand";
import { loginWithMock } from "../services/auth.service";
import { AuthUser } from "../types/auth.types";

export type { AuthUser, UserRole } from "../types/auth.types";

type AuthState = {
  user: AuthUser | null;
  login: (username: string, password: string) => { ok: boolean; message?: string };
  logout: () => void;
};

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  login: (username, password) => {
    const result = loginWithMock(username, password);

    if (!result.ok) {
      return {
        ok: false,
        message: result.message,
      };
    }

    set({ user: result.user });
    return { ok: true };
  },
  logout: () => set({ user: null }),
}));
