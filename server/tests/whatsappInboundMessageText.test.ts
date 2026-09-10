import assert from 'node:assert/strict';
import test from 'node:test';
import { extractWhatsAppInboundMessageText } from '../utils/whatsappInboundMessageText.js';
import type { WebhookMessage } from '../types/webhook.js';

function msg(partial: Partial<WebhookMessage>): WebhookMessage {
  return {
    id: 'wamid.test',
    from: '5511999999999',
    timestamp: '1788912000',
    type: partial.type ?? 'text',
    ...partial,
  };
}

test('extrai mensagem text.body', () => {
  assert.equal(extractWhatsAppInboundMessageText(msg({ type: 'text', text: { body: 'Ola' } })), 'Ola');
});

test('botao de template prefere button.text', () => {
  assert.equal(
    extractWhatsAppInboundMessageText(msg({
      type: 'button',
      button: { text: 'Sim', payload: 'confirm_presence_yes' },
    })),
    'Sim'
  );
});
test('botao usa button.payload como fallback', () => {
  assert.equal(
    extractWhatsAppInboundMessageText(msg({
      type: 'button',
      button: { payload: 'confirm_presence_yes' },
    })),
    'confirm_presence_yes'
  );
});

test('botao com texto vazio usa payload valido', () => {
  assert.equal(
    extractWhatsAppInboundMessageText(msg({
      type: 'button',
      button: { text: '   ', payload: 'confirm_presence_yes' },
    })),
    'confirm_presence_yes'
  );
});

test('interactive.button_reply usa titulo visivel', () => {
  assert.equal(
    extractWhatsAppInboundMessageText(msg({
      type: 'interactive',
      interactive: { type: 'button_reply', button_reply: { id: 'yes', title: 'Sim' } },
    })),
    'Sim'
  );
});

test('interactive.list_reply usa titulo visivel e preserva acentos', () => {
  assert.equal(
    extractWhatsAppInboundMessageText(msg({
      type: 'interactive',
      interactive: { type: 'list_reply', list_reply: { id: 'no', title: 'Não' } },
    })),
    'Não'
  );
});

test('imagem com legenda nao vira resposta textual processavel', () => {
  assert.equal(
    extractWhatsAppInboundMessageText(msg({
      type: 'image',
      image: { id: 'media-id', caption: 'Legenda visivel no inbox' },
    })),
    null
  );
});

test('retorna null quando nao ha texto recuperavel', () => {
  assert.equal(extractWhatsAppInboundMessageText(msg({ type: 'interactive', interactive: {} })), null);
  assert.equal(extractWhatsAppInboundMessageText(msg({ type: 'audio', audio: { id: 'media-id' } })), null);
});

test('texto visivel tem prioridade sobre id e payload interno', () => {
  assert.equal(
    extractWhatsAppInboundMessageText(msg({
      type: 'interactive',
      interactive: { button_reply: { id: 'internal_yes_id', title: 'Sim' } },
    })),
    'Sim'
  );
  assert.equal(
    extractWhatsAppInboundMessageText(msg({
      type: 'button',
      button: { text: 'Não', payload: 'internal_no_payload' },
    })),
    'Não'
  );
});
