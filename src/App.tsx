import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { InboxPage } from './pages/InboxPage';
import { SettingsWhatsAppPage } from './pages/SettingsWhatsAppPage';
import { LeadSimulatorPage } from './pages/LeadSimulatorPage';
import { EmpreendimentosPage } from './pages/EmpreendimentosPage';
import { CorretoresPage } from './pages/CorretoresPage';
import { AgendaPage } from './pages/AgendaPage';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/inbox" element={<InboxPage />} />
        <Route path="/agenda" element={<AgendaPage />} />
        <Route path="/settings/empreendimentos" element={<EmpreendimentosPage />} />
        <Route path="/settings/corretores" element={<CorretoresPage />} />
        <Route path="/settings/integrations/whatsapp" element={<SettingsWhatsAppPage />} />
        <Route path="/lead-simulator" element={<LeadSimulatorPage />} />
        <Route path="/" element={<Navigate to="/inbox" replace />} />
        <Route path="*" element={<Navigate to="/inbox" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
