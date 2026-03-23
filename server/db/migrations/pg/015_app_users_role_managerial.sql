-- Perfil MANAGERIAL (gerencial): mesmo acesso operacional do admin, sem tela de configurações (integrações/IA).
ALTER TABLE app_users DROP CONSTRAINT IF EXISTS app_users_role_check;
ALTER TABLE app_users ADD CONSTRAINT app_users_role_check CHECK (role IN ('ADMIN', 'COLLABORATOR', 'MANAGERIAL'));
