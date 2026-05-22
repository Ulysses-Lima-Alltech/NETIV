import { ApiRequestError, requestJson } from "./api";
import { TEAM_MEMBERS_MOCK } from "../mocks/team.mock";
import { TeamEnterprise, TeamMember, TeamMemberRole } from "../types/team.types";

type MobileTeamEnterpriseResponse = {
  enterpriseId: string;
  enterpriseName: string;
  manageable: boolean;
  label: string | null;
};

type MobileTeamMemberResponse = {
  id: string;
  name: string;
  phone: string | null;
  role: TeamMemberRole;
  active: boolean;
  enterprises: MobileTeamEnterpriseResponse[];
};

type MobileTeamListResponse = {
  members: MobileTeamMemberResponse[];
};

type MobileTeamMemberEnvelope = {
  member: MobileTeamMemberResponse;
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

function normalizeTeamMember(member: MobileTeamMemberResponse): TeamMember {
  return {
    id: String(member.id ?? ""),
    name: typeof member.name === "string" && member.name.trim() ? member.name : "Sem nome",
    phone: typeof member.phone === "string" ? member.phone : null,
    role: member.role,
    active: member.active === true,
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

export async function getTeamByRoleFallback(role: TeamMemberRole): Promise<TeamMember[]> {
  if (role === "CORRETOR") {
    return [];
  }

  return TEAM_MEMBERS_MOCK.map((member) => ({
    ...member,
    phone: member.phone ?? null,
    enterprises: member.enterprises.map((enterprise) => ({
      enterpriseId: enterprise.enterpriseId,
      enterpriseName: enterprise.enterpriseName,
      manageable: enterprise.manageable,
      label: enterprise.label ?? null,
    })),
  }));
}
