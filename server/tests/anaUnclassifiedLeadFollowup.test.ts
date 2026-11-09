import assert from 'node:assert/strict';
import test from 'node:test';
import type { WhatsAppTemplateCatalogItem } from '../catalogs/whatsappTemplates.js';
import {
  getFollowupDeliveryType,
  getUnclassifiedFollowupTemplatesFromCatalog,
} from '../services/anaUnclassifiedLeadFollowupService.js';

function marketingTemplate(overrides: Partial<WhatsAppTemplateCatalogItem> = {}): WhatsAppTemplateCatalogItem {
  return {
    key: 'followup_lead',
    name: 'Follow-up Lead',
    languageCode: 'pt_BR',
    category: 'MARKETING',
    status: 'APPROVED',
    source: 'meta',
    variables: [],
    messageBodyTemplate: 'Olá! Podemos ajudar você a encontrar um empreendimento?',
    ...overrides,
  };
}

test('classifica texto livre só dentro da janela de 24h', () => {
  const now = Date.parse('2026-11-09T12:00:00.000Z');
  assert.equal(getFollowupDeliveryType(new Date(now - 24 * 60 * 60 * 1000 + 1), now), 'SERVICE_TEXT');
  assert.equal(getFollowupDeliveryType(new Date(now - 24 * 60 * 60 * 1000), now), 'MARKETING_TEMPLATE');
  assert.equal(getFollowupDeliveryType('not-a-date', now), 'MARKETING_TEMPLATE');
});

test('lista somente templates Marketing aprovados, pt_BR, sem variáveis ou mídia', () => {
  const templates = getUnclassifiedFollowupTemplatesFromCatalog([
    marketingTemplate(),
    marketingTemplate({ key: 'pending', status: 'PENDING' }),
    marketingTemplate({ key: 'utility', category: 'UTILITY' }),
    marketingTemplate({
      key: 'with_variable',
      variables: [{ id: 1, label: 'Nome', required: true }],
    }),
    marketingTemplate({ key: 'with_media', requiresHeaderMedia: true }),
    marketingTemplate({ key: 'english', languageCode: 'en_US' }),
  ], false);
  assert.deepEqual(templates.map((item) => item.key), ['followup_lead']);
});

test('não lista templates locais quando a Meta não foi consultada', () => {
  assert.deepEqual(
    getUnclassifiedFollowupTemplatesFromCatalog([marketingTemplate()], true),
    []
  );
});
