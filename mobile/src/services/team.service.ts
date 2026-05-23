import { ApiRequestError, requestJson } from "./api";
import { TEAM_MEMBERS_MOCK } from "../mocks/team.mock";
import {
  TeamEnterprise,
  TeamMember,
  TeamMemberRole,
  TeamMobileAccess,
} from "../types/team.types";

type MobileTeamEnterpriseResponse = {
  enterpriseId: string;
  enterpriseName: string;
  manageable: boolean;
  label: string | null;
};

type MobileTeamAccessResponse = {
  id: string;
  username: string;
  role: TeamMemberRole;
  active: boolean;
};

type MobileTeamMemberResponse = {
  id: string;
  name: string;
  phone: string | null;
  role: TeamMemberRole;
  active: boolean;
  mobileAccess: MobileTeamAccessResponse | null;
  enterprises: MobileTeamEnterpriseResponse[];
};

type MobileTeamListResponse = {
  members: MobileTeamMemberResponse[];
};

type MobileTeamMemberEnvelope = {
  member: MobileTeamMemberResponse;
};

type MobileCreateAccessEnvelope = {
  user: {
    id: string;
    username: string;
    name: string;
    role: TeamMemberRole;
    active: boolean;
  };
  member: MobileTeamMemberResponse;
};

type MobileEnterpriseOptionResponse = {
  id: string;
  name: string;
  active: boolean;
};

type MobileEnterpriseOptionsEnvelope = {
  enterprises: MobileEnterpriseOptionResponse[];
};

export type TeamEnterpriseOption = {
  id: string;
  name: string;
  active: boolean;
};

export type TeamCreatedAccess = {
  id: string;
  username: string;
  name: string;
  role: TeamMemberRole;
  active: boolean;
};

export type CreateTeamAccessPayload = {
  username: string;
  temporaryPassword: string;
  role: "CORRETOR" | "GESTOR";
  active: boolean;
};

function normalizeEnterprise(enterprise: MobileTeamEnterpriseResponse): TeamEnterprise {
  const manageable = enterprise.manageable === true;
  return {
    enterpriseId: String(enterprise.enterpriseId ?? ""),
    enterpriseName:
      typeof enterprise.enterpriseName === "string" && enterprise.enterpriseName.trim()
        ? enterprise.enterpriseName
        : "Sem empreendimento",
    manageable,
    label:
      typeof enterprise.label === "string" && enterprise.label.trim()
        ? enterprise.label
        : manageable
          ? "Gerenciavel"
          : "Somente visualizacao",
  };
}

function normalizeMobileAccess(access: MobileTeamAccessResponse | null): TeamMobileAccess | null {
  if (!access || typeof access !== "object") {
    return null;
  }

  const id = String(access.id ?? "").trim();
  const username = typeof access.username === "string" ? access.username.trim() : "";
  if (!id || !username) {
    return null;
  }

  return {
    id,
    username,
    role: access.role,
    active: access.active === true,
  };
}

function normalizeTeamMember(member: MobileTeamMemberResponse): TeamMember {
  return {
    id: String(member.id ?? ""),
    name: typeof member.name === "string" && member.name.trim() ? member.name : "Sem nome",
    phone: typeof member.phone === "string" ? member.phone : null,
    role: member.role,
    active: member.active === true,
    mobileAccess: normalizeMobileAccess(member.mobileAccess),
    enterprises: Array.isArray(member.enterprises) ? member.enterprises.map(normalizeEnterprise) : [],
  };
}

export function isTeamApiFallbackAllowed(error: unknown): boolean {
  return (
    error instanceof ApiRequestError &&
    (error.message === "NETWORK_ERROR" || error.status == null || error.status >= 500)
  );
}

export async function getTeamWithApi(token: string): Promise<TeamMember[]> {
  const response = await requestJson<MobileTeamListResponse>("/api/mobile/team", {
    method: "GET",
    token,
  });

  if (!response || !Array.isArray(response.members)) {
    throw new Error("INVALID_TEAM_PAYLOAD");
  }

  return response.members
    .filter((member) => member && typeof member === "object" && typeof member.id === "string")
    .map(normalizeTeamMember);
}

export async function updateTeamMemberWithApi(
  memberId: string,
  token: string,
  payload: { name?: string; phone?: string; active?: boolean }
): Promise<TeamMember> {
  const body: Record<string, unknown> = {};
  if (payload.name !== undefined) body.name = payload.name;
  if (payload.phone !== undefined) body.phone = payload.phone;
  if (payload.active !== undefined) body.active = payload.active;

  const response = await requestJson<MobileTeamMemberEnvelope>(`/api/mobile/team/${memberId}`, {
    method: "PATCH",
    token,
    body,
  });

  if (!response?.member || typeof response.member !== "object") {
    throw new Error("INVALID_TEAM_MEMBER_PAYLOAD");
  }

  return normalizeTeamMember(response.member);
}

export async function addEnterpriseToTeamMemberWithApi(
  memberId: string,
  enterpriseId: string,
  token: string
): Promise<TeamMember> {
  const response = await requestJson<MobileTeamMemberEnvelope>(`/api/mobile/team/${memberId}/enterprises`, {
    method: "POST",
    token,
    body: { enterpriseId },
  });

  if (!response?.member || typeof response.member !== "object") {
    throw new Error("INVALID_TEAM_MEMBER_PAYLOAD");
  }

  return normalizeTeamMember(response.member);
}

export async function removeEnterpriseFromTeamMemberWithApi(
  memberId: string,
  enterpriseId: string,
  token: string
): Promise<TeamMember> {
  const response = await requestJson<MobileTeamMemberEnvelope>(
    `/api/mobile/team/${memberId}/enterprises/${enterpriseId}`,
    {
      method: "DELETE",
      token,
    }
  );

  if (!response?.member || typeof response.member !== "object") {
    throw new Error("INVALID_TEAM_MEMBER_PAYLOAD");
  }

  return normalizeTeamMember(response.member);
}

export async function getEnterpriseOptionsWithApi(token: string): Promise<TeamEnterpriseOption[]> {
  const response = await requestJson<MobileEnterpriseOptionsEnvelope>("/api/mobile/enterprises", {
    method: "GET",
    token,
  });

  if (!response || !Array.isArray(response.enterprises)) {
    throw new Error("INVALID_ENTERPRISE_OPTIONS_PAYLOAD");
  }

  return response.enterprises
    .filter(
      (enterprise) =>
        enterprise &&
        typeof enterprise.id === "string" &&
        typeof enterprise.name === "string" &&
        typeof enterprise.active === "boolean"
    )
    .map((enterprise) => ({
      id: enterprise.id,
      name: enterprise.name,
      active: enterprise.active,
    }));
}

export async function createMobileAccessForTeamMemberWithApi(
  memberId: string,
  token: string,
  payload: CreateTeamAccessPayload
): Promise<{ user: TeamCreatedAccess; member: TeamMember }> {
  const response = await requestJson<MobileCreateAccessEnvelope>(`/api/mobile/team/${memberId}/access`, {
    method: "POST",
    token,
    body: payload,
  });

  if (
    !response ||
    !response.member ||
    typeof response.member !== "object" ||
    !response.user ||
    typeof response.user !== "object"
  ) {
    throw new Error("INVALID_TEAM_ACCESS_PAYLOAD");
  }

  return {
    user: {
      id: String(response.user.id ?? ""),
      username: String(response.user.username ?? ""),
      name: String(response.user.name ?? ""),
      role: response.user.role,
      active: response.user.active === true,
    },
    member: normalizeTeamMember(response.member),
  };
}

export async function getTeamByRoleFallback(role: TeamMemberRole): Promise<TeamMember[]> {
  if (role === "CORRETOR") {
    return [];
  }

  return TEAM_MEMBERS_MOCK.map((member) => ({
    ...member,
    phone: member.phone ?? null,
    mobileAccess: member.mobileAccess ?? null,
    enterprises: member.enterprises.map((enterprise) => ({
      enterpriseId: enterprise.enterpriseId,
      enterpriseName: enterprise.enterpriseName,
      manageable: enterprise.manageable,
      label: enterprise.label ?? null,
    })),
  }));
}
