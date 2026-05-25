import * as SecureStore from "expo-secure-store";
import { create } from "zustand";
import { getMeWithApi, loginWithApi } from "../services/auth.service";
import { AuthUser } from "../types/auth.types";

export type { AuthUser, UserRole } from "../types/auth.types";

const AUTH_TOKEN_KEY = "netiv_mobile_auth_token";

type LoginResult = {
  ok: boolean;
  message?: string;
};

type AuthState = {
  user: AuthUser | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (username: string, password: string) => Promise<LoginResult>;
  logout: () => Promise<void>;
  restoreSession: () => Promise<void>;
};

function clearAuthState(set: (partial: Partial<AuthState>) => void) {
  set({
    user: null,
    token: null,
    isAuthenticated: false,
    isLoading: false,
  });
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: null,
  isLoading: false,
  isAuthenticated: false,

  login: async (username, password) => {
    set({ isLoading: true });

    const result = await loginWithApi(username, password);
    if (!result.ok) {
      set({
        user: null,
        token: null,
        isAuthenticated: false,
        isLoading: false,
      });
      return { ok: false, message: result.message };
    }

    try {
      await SecureStore.setItemAsync(AUTH_TOKEN_KEY, result.token);
    } catch {
      set({ isLoading: false });
      return {
        ok: false,
        message: "Nao foi possivel salvar a sessao no dispositivo.",
      };
    }

    set({
      user: result.user,
      token: result.token,
      isAuthenticated: true,
      isLoading: false,
    });
    return { ok: true };
  },

  logout: async () => {
    set({ isLoading: true });

    try {
      await SecureStore.deleteItemAsync(AUTH_TOKEN_KEY);
    } finally {
      clearAuthState(set);
    }
  },

  restoreSession: async () => {
    set({ isLoading: true });

    let storedToken: string | null = null;
    try {
      storedToken = await SecureStore.getItemAsync(AUTH_TOKEN_KEY);
    } catch {
      clearAuthState(set);
      return;
    }

    if (!storedToken) {
      clearAuthState(set);
      return;
    }

    const meResult = await getMeWithApi(storedToken);
    if (meResult.ok) {
      set({
        user: meResult.user,
        token: storedToken,
        isAuthenticated: true,
        isLoading: false,
      });
      return;
    }

    if (meResult.code === "UNAUTHORIZED") {
      try {
        await SecureStore.deleteItemAsync(AUTH_TOKEN_KEY);
      } catch {
        // noop
      }
    }

    set({
      user: null,
      token: meResult.code === "NETWORK" ? storedToken : null,
      isAuthenticated: false,
      isLoading: false,
    });
  },
}));
