import { AUTH_MOCK_USERS } from "../mocks/auth.mock";
import { AuthUser } from "../types/auth.types";
import { ApiRequestError, requestJson } from "./api";

type AuthErrorCode = "INVALID_CREDENTIALS" | "NETWORK" | "UNAUTHORIZED" | "SERVER" | "UNKNOWN";

type AuthErrorResult = {
  ok: false;
  message: string;
  code: AuthErrorCode;
};

export type LoginWithMockResult = { ok: true; user: AuthUser } | AuthErrorResult;

export type LoginWithApiResult = { ok: true; token: string; user: AuthUser } | AuthErrorResult;

export type GetMeWithApiResult = { ok: true; user: AuthUser } | AuthErrorResult;

type MobileLoginResponse = {
  token: string;
  user: {
    id: string;
    username: string;
    name: string;
    role: AuthUser["role"];
  };
};

type MobileMeResponse = {
  user: {
    id: string;
    username: string;
    name: string;
    role: AuthUser["role"];
  };
};

function normalizeAuthUser(payload: {
  id: string;
  username: string;
  name: string;
  role: AuthUser["role"];
}): AuthUser {
  return {
    id: String(payload.id),
    username: payload.username,
    name: payload.name,
    role: payload.role,
  };
}

function resolveAuthError(error: unknown): AuthErrorResult {
  if (error instanceof ApiRequestError) {
    if (error.message === "NETWORK_ERROR") {
      return {
        ok: false,
        message: "Nao foi possivel conectar ao servidor.",
        code: "NETWORK",
      };
    }

    if (error.status === 401) {
      return {
        ok: false,
        message: "Usuario ou senha invalidos.",
        code: "INVALID_CREDENTIALS",
      };
    }

    if (error.status === 403) {
      return {
        ok: false,
        message: "Usuario sem acesso ao app mobile.",
        code: "UNAUTHORIZED",
      };
    }

    if (error.status && error.status >= 500) {
      return {
        ok: false,
        message: "Servidor indisponivel no momento. Tente novamente.",
        code: "SERVER",
      };
    }
  }

  return {
    ok: false,
    message: "Nao foi possivel concluir o login.",
    code: "UNKNOWN",
  };
}

export function loginWithMock(username: string, password: string): LoginWithMockResult {
  const normalizedUsername = username.trim().toLowerCase();
  const normalizedPassword = password.trim();

  const foundUser = AUTH_MOCK_USERS.find(
    (item) => item.username === normalizedUsername && item.password === normalizedPassword
  );

  if (!foundUser) {
    return {
      ok: false,
      message: "Usuario ou senha invalidos.",
      code: "INVALID_CREDENTIALS",
    };
  }

  const { password: _password, ...safeUser } = foundUser;
  return { ok: true, user: safeUser };
}

export async function loginWithApi(username: string, password: string): Promise<LoginWithApiResult> {
  try {
    const response = await requestJson<MobileLoginResponse>("/api/mobile/auth/login", {
      method: "POST",
      body: {
        username: username.trim(),
        password: password.trim(),
      },
    });

    if (!response?.token || !response?.user) {
      return {
        ok: false,
        message: "Resposta invalida do servidor.",
        code: "SERVER",
      };
    }

    return {
      ok: true,
      token: response.token,
      user: normalizeAuthUser(response.user),
    };
  } catch (error) {
    return resolveAuthError(error);
  }
}

export async function getMeWithApi(token: string): Promise<GetMeWithApiResult> {
  try {
    const response = await requestJson<MobileMeResponse>("/api/mobile/auth/me", {
      method: "GET",
      token,
    });

    if (!response?.user) {
      return {
        ok: false,
        message: "Resposta invalida do servidor.",
        code: "SERVER",
      };
    }

    return {
      ok: true,
      user: normalizeAuthUser(response.user),
    };
  } catch (error) {
    const mapped = resolveAuthError(error);
    if (mapped.code === "INVALID_CREDENTIALS") {
      return {
        ok: false,
        message: "Sessao expirada. Faca login novamente.",
        code: "UNAUTHORIZED",
      };
    }
    return mapped;
  }
}
