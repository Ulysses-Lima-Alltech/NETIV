import { HOME_SUMMARY_BY_ROLE_MOCK } from "../mocks/home.mock";
import { AuthUser } from "../types/auth.types";
import { HomeSummary } from "../types/home.types";

export function getHomeSummaryByRole(user: AuthUser | null | undefined): Promise<HomeSummary> {
  const role = user?.role ?? "CORRETOR";
  const baseSummary = HOME_SUMMARY_BY_ROLE_MOCK[role];

  return Promise.resolve({
    ...baseSummary,
    subtitle: user?.name ?? "Usuario",
  });
}
