import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { InboxPage } from './pages/InboxPage';
import { SettingsWhatsAppPage } from './pages/SettingsWhatsAppPage';
import { SendWhatsAppPage } from './pages/SendWhatsAppPage';
import { WhatsAppTestPage } from './pages/WhatsAppTestPage';
import { LeadSimulatorPage } from './pages/LeadSimulatorPage';
import { EmpreendimentosPage } from './pages/EmpreendimentosPage';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/inbox" element={<InboxPage />} />
        <Route path="/settings/empreendimentos" element={<EmpreendimentosPage />} />
        <Route path="/settings/integrations/whatsapp" element={<SettingsWhatsAppPage />} />
        <Route path="/enviar-whatsapp" element={<WhatsAppTestPage />} />
        <Route path="/whatsapp-enviar" element={<SendWhatsAppPage />} />
        <Route path="/lead-simulator" element={<LeadSimulatorPage />} />
        <Route path="/" element={<Navigate to="/inbox" replace />} />
        <Route path="*" element={<Navigate to="/inbox" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
