import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import { AuthProvider } from './contexts/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { ROLES_ORG_ADMIN, ROLES_SETTINGS_ADMIN } from './constants/roles';
import { InboxPage } from './pages/InboxPage';
import { DashboardPage } from './pages/DashboardPage';
import { SettingsWhatsAppPage } from './pages/SettingsWhatsAppPage';
import { LeadSimulatorPage } from './pages/LeadSimulatorPage';
import { EmpreendimentosPage } from './pages/EmpreendimentosPage';
import { CorretoresPage } from './pages/CorretoresPage';
import { AgendaPage } from './pages/AgendaPage';
import { UsersPage } from './pages/UsersPage';
import { LoginPage } from './pages/LoginPage';
import { ContatosPage } from './pages/ContatosPage';
import { WhatsAppBatchTemplatePage } from './pages/WhatsAppBatchTemplatePage';
import { AppShell } from './components/layout/AppShell';
import type { UserRole } from './api/client';

interface ProtectedShellRouteProps {
  children: ReactNode;
  roles?: UserRole[];
}

function ProtectedShellRoute({ children, roles }: ProtectedShellRouteProps) {
  return (
    <ProtectedRoute roles={roles}>
      <AppShell>{children}</AppShell>
    </ProtectedRoute>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route
            path="/inbox"
            element={
              <ProtectedShellRoute>
                <InboxPage />
              </ProtectedShellRoute>
            }
          />
          <Route
            path="/dashboard"
            element={
              <ProtectedShellRoute>
                <DashboardPage />
              </ProtectedShellRoute>
            }
          />
          <Route
            path="/agenda"
            element={
              <ProtectedShellRoute>
                <AgendaPage />
              </ProtectedShellRoute>
            }
          />
          <Route
            path="/settings/empreendimentos"
            element={
              <ProtectedShellRoute roles={[...ROLES_ORG_ADMIN]}>
                <EmpreendimentosPage />
              </ProtectedShellRoute>
            }
          />
          <Route
            path="/settings/corretores"
            element={
              <ProtectedShellRoute roles={[...ROLES_ORG_ADMIN]}>
                <CorretoresPage />
              </ProtectedShellRoute>
            }
          />
          <Route
            path="/settings/integrations/whatsapp"
            element={
              <ProtectedShellRoute roles={[...ROLES_SETTINGS_ADMIN]}>
                <SettingsWhatsAppPage />
              </ProtectedShellRoute>
            }
          />
          <Route
            path="/users"
            element={
              <ProtectedShellRoute roles={[...ROLES_ORG_ADMIN]}>
                <UsersPage />
              </ProtectedShellRoute>
            }
          />
          <Route
            path="/contatos"
            element={
              <ProtectedShellRoute roles={[...ROLES_SETTINGS_ADMIN]}>
                <ContatosPage />
              </ProtectedShellRoute>
            }
          />
          <Route
            path="/contatos/disparo-template-lote"
            element={
              <ProtectedShellRoute roles={[...ROLES_SETTINGS_ADMIN]}>
                <WhatsAppBatchTemplatePage />
              </ProtectedShellRoute>
            }
          />
          <Route path="/settings/whatsapp-batch" element={<Navigate to="/contatos/disparo-template-lote" replace />} />
          <Route path="/whatsapp-batch" element={<Navigate to="/contatos/disparo-template-lote" replace />} />
          <Route
            path="/lead-simulator"
            element={
              <ProtectedShellRoute>
                <LeadSimulatorPage />
              </ProtectedShellRoute>
            }
          />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<Navigate to="/inbox" replace />} />
          <Route path="*" element={<Navigate to="/inbox" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
