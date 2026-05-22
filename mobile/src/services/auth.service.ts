import { AUTH_MOCK_USERS } from "../mocks/auth.mock";
import { AuthUser } from "../types/auth.types";

export type LoginWithMockResult =
  | { ok: true; user: AuthUser }
  | { ok: false; message: string };

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
    };
  }

  const { password: _password, ...safeUser } = foundUser;
  return { ok: true, user: safeUser };
}
