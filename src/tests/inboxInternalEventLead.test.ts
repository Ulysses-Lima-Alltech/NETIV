import { describe, expect, it } from 'vitest';
import { getInboxTab, matchesInboxTab } from '../utils/inboxConversationTab';

describe('leads de disparo no Inbox', () => {
  it('exibe leads de evento na aba INTERNO sem mudar seu tipo operacional', () => {
    const lead = { conversationType: 'CLIENT', isEventLead: true };
    expect(getInboxTab(lead)).toBe('INTERNO');
    expect(matchesInboxTab(lead, 'CLIENT')).toBe(false);
    expect(lead.conversationType).toBe('CLIENT');
  });

  it('mantem clientes comuns em Clientes e internos existentes em INTERNO', () => {
    expect(getInboxTab({ conversationType: 'CLIENT' })).toBe('CLIENT');
    expect(getInboxTab({ conversationType: 'ADMIN' })).toBe('INTERNO');
    expect(getInboxTab({ conversationType: 'CORRETOR' })).toBe('INTERNO');
  });
});
