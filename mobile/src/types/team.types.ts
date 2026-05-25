export type TeamMemberRole = "CORRETOR" | "GESTOR" | "ADM";

export type TeamMobileAccess = {
  id: string;
  username: string;
  role: TeamMemberRole;
  active: boolean;
};

export type TeamEnterprise = {
  enterpriseId: string;
  enterpriseName: string;
  manageable: boolean;
  label?: string | null;
};

export type TeamMember = {
  id: string;
  name: string;
  phone: string | null;
  role: TeamMemberRole;
  active: boolean;
  mobileAccess: TeamMobileAccess | null;
  enterprises: TeamEnterprise[];
};

export type EnterpriseLink = {
  enterpriseName: string;
  manageable: boolean;
  label?: string;
};
