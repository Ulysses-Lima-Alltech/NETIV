import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  filterBlockedWhatsappSenderMessages,
  isBlockedWhatsappSender,
  NETIV_BLOCKED_WHATSAPP_SENDERS_ENV,
  normalizeWhatsappSender,
} from '../services/blockedWhatsappSenders.js';
import type { WebhookPayload } from '../types/webhook.js';

function payloadFor(from: string, type: 'text' | 'image' = 'text'): WebhookPayload {
  return {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'entry-1',
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: { display_phone_number: '5511000000000', phone_number_id: 'phone-id' },
          contacts: [{ profile: { name: 'Contato' }, wa_id: normalizeWhatsappSender(from) ?? from }],
          messages: [{
            id: `wamid.${type}.${normalizeWhatsappSender(from)}`,
            from,
            timestamp: '1790170000',
            type,
            ...(type === 'text'
              ? { text: { body: 'conteudo sensivel que nao deve ser persistido' } }
              : { image: { id: 'media-id', caption: 'legenda sensivel que nao deve ser persistida' } }),
          }],
        },
      }],
    }],
  };
}

function readWebhookSource(): string {
  try {
    return readFileSync(new URL('../services/webhookProcessor.ts', import.meta.url), 'utf8');
  } catch {
    return readFileSync(new URL('../services/webhookProcessor.js', import.meta.url), 'utf8');
  }
}

test('normaliza remetentes com ou sem + e bloqueia o numero configurado', () => {
  const env = { [NETIV_BLOCKED_WHATSAPP_SENDERS_ENV]: '5511924995845' };
  assert.equal(normalizeWhatsappSender('+55 11 92499-5845'), '5511924995845');
  assert.equal(isBlockedWhatsappSender('+5511924995845', env), true);
  assert.equal(isBlockedWhatsappSender('5511924995845', env), true);
});

test('nao bloqueia outro numero semelhante', () => {
  const env = { [NETIV_BLOCKED_WHATSAPP_SENDERS_ENV]: '5511924995845' };
  assert.equal(isBlockedWhatsappSender('5511924995846', env), false);
  assert.equal(isBlockedWhatsappSender('11924995845', env), false);
});

test('remove mensagem de texto bloqueada antes de persistir ou responder', () => {
  const env = { [NETIV_BLOCKED_WHATSAPP_SENDERS_ENV]: '5511924995845' };
  const result = filterBlockedWhatsappSenderMessages(payloadFor('+5511924995845', 'text'), env);
  assert.equal(result.payload, null);
  assert.equal(result.blockedCount, 1);
  assert.equal(result.audit[0]?.senderTail, '5845');
  assert.ok(result.audit[0]?.senderHash);
  assert.equal(JSON.stringify(result.audit).includes('conteudo sensivel'), false);
  assert.equal(JSON.stringify(result.audit).includes('5511924995845'), false);
});

test('remove midia bloqueada antes de download/transcricao/inbox', () => {
  const env = { [NETIV_BLOCKED_WHATSAPP_SENDERS_ENV]: '5511924995845' };
  const result = filterBlockedWhatsappSenderMessages(payloadFor('5511924995845', 'image'), env);
  assert.equal(result.payload, null);
  assert.equal(result.blockedCount, 1);
  assert.equal(result.audit[0]?.type, 'image');
});

test('payload misto preserva remetente permitido e remove somente bloqueado', () => {
  const env = { [NETIV_BLOCKED_WHATSAPP_SENDERS_ENV]: '5511924995845' };
  const payload = payloadFor('5511924995845', 'text');
  payload.entry[0].changes[0].value.messages!.push({
    id: 'wamid.allowed',
    from: '5511924995846',
    timestamp: '1790170001',
    type: 'text',
    text: { body: 'mensagem permitida' },
  });

  const result = filterBlockedWhatsappSenderMessages(payload, env);
  assert.equal(result.blockedCount, 1);
  assert.equal(result.payload?.entry[0].changes[0].value.messages?.length, 1);
  assert.equal(result.payload?.entry[0].changes[0].value.messages?.[0]?.from, '5511924995846');
});

test('filtro roda antes do log bruto, resposta fixa global e midia', () => {
  const webhook = readWebhookSource();
  const processBody = webhook.slice(webhook.indexOf('export async function processIncomingWebhook'));
  assert.ok(processBody.indexOf('filterBlockedWhatsappSenderMessages(payload)') < processBody.indexOf('logWebhookEvent'));
  assert.ok(processBody.indexOf('filterBlockedWhatsappSenderMessages(payload)') < processBody.indexOf('isGlobalFixedWhatsappReplyEnabled'));
  assert.ok(processBody.indexOf('filterBlockedWhatsappSenderMessages(payload)') < processBody.indexOf('downloadAndStoreInboundMedia'));
});
