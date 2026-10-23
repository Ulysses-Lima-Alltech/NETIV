// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { DispatchEventModal } from '../components/DispatchEventModal';
import { WhatsAppBatchTemplatePage } from '../pages/WhatsAppBatchTemplatePage';

const mocks = vi.hoisted(() => ({
  projectList: vi.fn(),
  brokerList: vi.fn(),
  batchTemplateList: vi.fn(),
  metaTemplateList: vi.fn(),
}));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ isAdmin: true }),
}));

vi.mock('../components/AppNav', () => ({ AppNav: () => null }));
vi.mock('../components/DispatchEventsSection', () => ({ DispatchEventsSection: () => null }));

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>();
  return {
    ...actual,
    projectsApi: { ...actual.projectsApi, list: mocks.projectList },
    corretoresApi: { ...actual.corretoresApi, list: mocks.brokerList },
    whatsappApi: { ...actual.whatsappApi, listTemplates: mocks.metaTemplateList },
    whatsappBatchApi: { ...actual.whatsappBatchApi, listTemplates: mocks.batchTemplateList },
  };
});

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute('open');
  };
  mocks.projectList.mockResolvedValue({ projects: [] });
  mocks.brokerList.mockResolvedValue({ corretores: [] });
  mocks.batchTemplateList.mockResolvedValue({ templates: [], source: 'meta_sync' });
  mocks.metaTemplateList.mockResolvedValue({ templates: [], source: 'meta_sync' });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('atalho para Templates META pelo modal de evento', () => {
  it('navega diretamente para Templates META e abre a criação do modelo', async () => {
    const onClose = vi.fn();
    render(
      <MemoryRouter initialEntries={['/agenda']}>
        <Routes>
          <Route
            path="/agenda"
            element={<DispatchEventModal onClose={onClose} onSaved={vi.fn()} />}
          />
          <Route path="/contatos/disparo-template-lote" element={<WhatsAppBatchTemplatePage />} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.click(await screen.findByRole('button', { name: 'TEMPLATES META' }));

    expect(await screen.findByRole('heading', { name: 'Templates do WhatsApp' })).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'Identifique o modelo' })).toBeTruthy();
    expect(onClose).toHaveBeenCalledOnce();
    await waitFor(() => expect(mocks.metaTemplateList).toHaveBeenCalled());
  });
});
