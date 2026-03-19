import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { LoginPage } from './pages/LoginPage';
import { InboxPage } from './pages/InboxPage';
import { SettingsWhatsAppPage } from './pages/SettingsWhatsAppPage';
import { LeadSimulatorPage } from './pages/LeadSimulatorPage';
import { EmpreendimentosPage } from './pages/EmpreendimentosPage';
import { CorretoresPage } from './pages/CorretoresPage';
import { AgendaPage } from './pages/AgendaPage';
import { UsersPage } from './pages/UsersPage';

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/inbox"
            element={
              <ProtectedRoute>
                <InboxPage />
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
              <ProtectedRoute roles={['ADMIN']}>
                <EmpreendimentosPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings/corretores"
            element={
              <ProtectedRoute roles={['ADMIN']}>
                <CorretoresPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings/integrations/whatsapp"
            element={
              <ProtectedRoute roles={['ADMIN']}>
                <SettingsWhatsAppPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/users"
            element={
              <ProtectedRoute roles={['ADMIN']}>
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
          <Route path="/" element={<Navigate to="/inbox" replace />} />
          <Route path="*" element={<Navigate to="/inbox" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
