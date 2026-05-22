import {
  ENTERPRISES_MOCK,
  MANAGED_ENTERPRISE_NAMES_BY_GESTOR_MOCK,
} from "../mocks/enterprises.mock";
import { AuthUser } from "../types/auth.types";
import { Enterprise } from "../types/enterprise.types";

function cloneEnterprise(enterprise: Enterprise): Enterprise {
  return { ...enterprise };
}

export function getEnterprisesByRole(user: AuthUser | null | undefined): Promise<Enterprise[]> {
  const role = user?.role ?? "CORRETOR";

  if (role === "GESTOR") {
    return Promise.resolve(
      ENTERPRISES_MOCK.filter((enterprise) =>
        MANAGED_ENTERPRISE_NAMES_BY_GESTOR_MOCK.includes(enterprise.name)
      ).map(cloneEnterprise)
    );
  }

  return Promise.resolve(ENTERPRISES_MOCK.map(cloneEnterprise));
}
