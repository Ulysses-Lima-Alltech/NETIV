export type TeamMemberRole = "CORRETOR" | "GESTOR" | "ADM";

export type TeamMember = {
  id: string;
  name: string;
  phone: string;
  role: TeamMemberRole;
  active: boolean;
  enterprises: string[];
};

export type EnterpriseLink = {
  enterpriseName: string;
  manageable: boolean;
  label?: string;
};
