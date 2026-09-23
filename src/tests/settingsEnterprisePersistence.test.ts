import { describe, expect, it } from 'vitest';
import source from '../pages/SettingsWhatsAppPage.tsx?raw';

describe('SettingsWhatsAppPage enterprise persistence guard', () => {
  it('confirms PUT response and a fresh GET before showing success', () => {
    expect(source).toContain('assertEnterpriseBlockPersisted(saved, payload)');
    expect(source).toContain('const reloaded = await settingsApi.getApiEnterprises()');
    expect(source).toContain('assertEnterpriseBlockPersisted(persisted, payload)');
  });

  it('does not report success when emergency block message reload differs', () => {
    expect(source).toContain('item.emergency_block_message !== expected.emergency_block_message');
    expect(source).toContain('O servidor não confirmou o bloqueio e a mensagem');
  });
});
