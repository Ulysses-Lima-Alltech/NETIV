import assert from 'node:assert/strict';
import test from 'node:test';
import type { WhatsAppTemplateCatalogItem } from '../catalogs/whatsappTemplates.js';
import { renderWhatsAppTemplateMessage } from '../utils/whatsappTemplateMessage.js';

function template(components: Array<Record<string, unknown>>): WhatsAppTemplateCatalogItem {
  return {
    key: 'template_teste',
    name: 'Template teste',
    languageCode: 'pt_BR',
    metaTemplateName: 'template_teste',
    metaTemplateId: 'meta-123',
    category: 'MARKETING',
    status: 'APPROVED',
    components,
    variables: [],
  };
}

test('renderiza BODY completo com múltiplas variáveis, UTF-8, emoji, quebra e marcação', () => {
  const result = renderWhatsAppTemplateMessage({
    template: template([{ type: 'BODY', text: 'Olá, {{1}}!\n*Visita:* {{2}} 🏡' }]),
    parameterValues: ['Maria José', 'sábado'],
  });
  assert.equal(result.bodyOriginal, 'Olá, {{1}}!\n*Visita:* {{2}} 🏡');
  assert.equal(result.renderedText, 'Olá, Maria José!\n*Visita:* sábado 🏡');
  assert.deepEqual(result.parameters, [
    { position: 1, value: 'Maria José' },
    { position: 2, value: 'sábado' },
  ]);
});

test('bloqueia placeholder obrigatório não resolvido antes do envio', () => {
  assert.throws(
    () => renderWhatsAppTemplateMessage({
      template: template([{ type: 'BODY', text: 'Olá {{1}}, código {{2}}' }]),
      parameterValues: ['Maria'],
    }),
    /parâmetro\(s\) obrigatório\(s\) ausente\(s\): 2/
  );
});

for (const mediaType of ['image', 'video', 'document'] as const) {
  test(`preserva BODY e referência segura para HEADER ${mediaType}`, () => {
    const result = renderWhatsAppTemplateMessage({
      template: template([
        { type: 'HEADER', format: mediaType.toUpperCase() },
        { type: 'BODY', text: 'Olá {{1}}' },
      ]),
      parameterValues: ['Maria'],
      media: {
        settingId: 42,
        mediaId: 'media-123',
        fileName: `arquivo.${mediaType}`,
        mimeType: mediaType === 'image' ? 'image/jpeg' : mediaType === 'video' ? 'video/mp4' : 'application/pdf',
        sizeBytes: 100,
        storageFolder: 'disparos',
        configuredLink: false,
      },
    });
    assert.equal(result.header.type, mediaType);
    assert.equal(result.header.media?.settingId, 42);
    assert.equal(result.renderedText, 'Olá Maria');
    assert.equal('link' in (result.header.media ?? {}), false);
  });
}

test('preserva botões de URL e quick reply em metadata visível', () => {
  const result = renderWhatsAppTemplateMessage({
    template: template([
      { type: 'BODY', text: 'Olá {{1}}' },
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'URL', text: 'Como chegar', url: 'https://example.test/{{1}}' },
          { type: 'QUICK_REPLY', text: 'Confirmar' },
        ],
      },
    ]),
    parameterValues: ['maria'],
  });
  assert.deepEqual(result.buttons, [
    { type: 'url', text: 'Como chegar', url: 'https://example.test/maria', payload: null },
    { type: 'quick_reply', text: 'Confirmar', url: null, payload: 'Confirmar' },
  ]);
});

test('não volta ao resumo Variável 1 quando BODY veio de components', () => {
  const result = renderWhatsAppTemplateMessage({
    template: template([{ type: 'BODY', text: 'Conteúdo integral para {{1}}.' }]),
    parameterValues: ['Maria'],
  });
  assert.equal(result.renderedText, 'Conteúdo integral para Maria.');
  assert.doesNotMatch(result.renderedText, /^Variável 1:/);
});
