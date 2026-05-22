export type TeamMemberRole = "CORRETOR" | "GESTOR" | "ADM";

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
  enterprises: TeamEnterprise[];
};

export type EnterpriseLink = {
  enterpriseName: string;
  manageable: boolean;
  label?: string;
};
