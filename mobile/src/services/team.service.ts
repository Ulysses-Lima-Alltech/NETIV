import {
  ALL_ENTERPRISE_NAMES_MOCK,
  MANAGED_ENTERPRISES_BY_GESTOR_MOCK,
  TEAM_MEMBERS_MOCK,
} from "../mocks/team.mock";
import { AuthUser } from "../types/auth.types";
import { EnterpriseLink, TeamMember, TeamMemberRole } from "../types/team.types";

const EDITED_SUFFIX = " (editado)";
const ALTERNATE_PHONE = "(11) 90000-0000";
const DEFAULT_EDITED_PHONE = "(11) 98888-1000";

let teamState: TeamMember[] = TEAM_MEMBERS_MOCK.map((member) => ({ ...member }));

function cloneTeamMember(member: TeamMember): TeamMember {
  return { ...member, enterprises: [...member.enterprises] };
}

function getNextEnterprise(current: string[]): string {
  const missingEnterprise = ALL_ENTERPRISE_NAMES_MOCK.find((enterprise) => !current.includes(enterprise));
  return missingEnterprise ?? ALL_ENTERPRISE_NAMES_MOCK[0];
}

function updateTeamState(memberId: string, updater: (member: TeamMember) => TeamMember): TeamMember | null {
  let updatedMember: TeamMember | null = null;

  teamState = teamState.map((member) => {
    if (member.id !== memberId) {
      return member;
    }

    updatedMember = updater(member);
    return updatedMember;
  });

  return updatedMember;
}

export function canManageEnterprise(userRole: TeamMemberRole, enterpriseName: string): boolean {
  if (userRole === "ADM") {
    return true;
  }

  if (userRole === "GESTOR") {
    return MANAGED_ENTERPRISES_BY_GESTOR_MOCK.includes(enterpriseName);
  }

  return false;
}

export function getEnterpriseLink(enterpriseName: string, userRole: TeamMemberRole): EnterpriseLink {
  const manageable = canManageEnterprise(userRole, enterpriseName);

  return {
    enterpriseName,
    manageable,
    label: manageable ? "Gerenciavel" : "Somente visualizacao",
  };
}

export function getTeamByRole(user: AuthUser | null | undefined): Promise<TeamMember[]> {
  const role = user?.role ?? "CORRETOR";

  if (role === "ADM") {
    return Promise.resolve(teamState.map(cloneTeamMember));
  }

  if (role === "GESTOR") {
    return Promise.resolve(
      teamState
        .filter(
          (member) =>
            member.role === "CORRETOR" &&
            member.enterprises.some((enterprise) => MANAGED_ENTERPRISES_BY_GESTOR_MOCK.includes(enterprise))
        )
        .map(cloneTeamMember)
    );
  }

  return Promise.resolve([]);
}

export function updateMockTeamMember(memberId: string): Promise<TeamMember | null> {
  const updatedMember = updateTeamState(memberId, (member) => {
    const alreadyEdited = member.name.includes(EDITED_SUFFIX);
    const nextName = alreadyEdited ? member.name.replace(EDITED_SUFFIX, "") : `${member.name}${EDITED_SUFFIX}`;
    const nextPhone = member.phone === ALTERNATE_PHONE ? DEFAULT_EDITED_PHONE : ALTERNATE_PHONE;

    return {
      ...member,
      name: nextName,
      phone: nextPhone,
    };
  });

  return Promise.resolve(updatedMember ? cloneTeamMember(updatedMember) : null);
}

export function toggleMockTeamMemberActive(memberId: string): Promise<TeamMember | null> {
  const updatedMember = updateTeamState(memberId, (member) => ({
    ...member,
    active: !member.active,
  }));

  return Promise.resolve(updatedMember ? cloneTeamMember(updatedMember) : null);
}

export function addMockEnterpriseToMember(memberId: string): Promise<TeamMember | null> {
  const updatedMember = updateTeamState(memberId, (member) => {
    const enterprise = getNextEnterprise(member.enterprises);

    if (member.enterprises.includes(enterprise)) {
      return member;
    }

    return {
      ...member,
      enterprises: [...member.enterprises, enterprise],
    };
  });

  return Promise.resolve(updatedMember ? cloneTeamMember(updatedMember) : null);
}
