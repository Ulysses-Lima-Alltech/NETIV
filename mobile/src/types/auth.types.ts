export type UserRole = "CORRETOR" | "GESTOR" | "ADM";

export type AuthUser = {
  id: string;
  username: string;
  name: string;
  role: UserRole;
};
