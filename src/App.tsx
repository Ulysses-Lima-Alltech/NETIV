import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
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

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route
            path="/inbox"
            element={
              <ProtectedRoute>
                <InboxPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <DashboardPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/agenda"
            element={
              <ProtectedRoute>
                <AgendaPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings/empreendimentos"
            element={
              <ProtectedRoute roles={[...ROLES_ORG_ADMIN]}>
                <EmpreendimentosPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings/corretores"
            element={
              <ProtectedRoute roles={[...ROLES_ORG_ADMIN]}>
                <CorretoresPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings/integrations/whatsapp"
            element={
              <ProtectedRoute roles={[...ROLES_SETTINGS_ADMIN]}>
                <SettingsWhatsAppPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/users"
            element={
              <ProtectedRoute roles={[...ROLES_ORG_ADMIN]}>
                <UsersPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/lead-simulator"
            element={
              <ProtectedRoute>
                <LeadSimulatorPage />
              </ProtectedRoute>
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
