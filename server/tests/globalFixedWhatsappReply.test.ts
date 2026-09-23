import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  GLOBAL_FIXED_WHATSAPP_REPLY,
  isGlobalFixedWhatsappReplyEnabled,
  sendGlobalFixedWhatsappReply,
} from '../services/globalFixedWhatsappReply.js';
import { sendAnaTextMessageWithQuota } from '../services/anaOutboundQuotaService.js';

test('global reply uses the exact two-line text and persists the outbound message', async () => {
  let sent: string | null = null;
  let persisted: string | null = null;
  const ok = await sendGlobalFixedWhatsappReply({
    conversationId: 4,
    to: '5511999999999',
    inboundMetaMessageId: 'wamid.inbound',
    send: async (_to, text) => {
      sent = text;
      return { success: true, metaMessageId: 'wamid.outbound' };
    },
    persist: async (_id, text, mid) => {
      assert.equal(mid, 'wamid.outbound');
      persisted = text;
    },
  });
  assert.equal(ok, true);
  assert.equal(sent, GLOBAL_FIXED_WHATSAPP_REPLY);
  assert.equal(persisted, GLOBAL_FIXED_WHATSAPP_REPLY);
  assert.equal(GLOBAL_FIXED_WHATSAPP_REPLY,
    'Olá, que bom ter você por aqui !\nEm breve um dos nossos consultores entrará em contato para passar as informações do empreendimento');
});

test('failed send does not persist a reply', async () => {
  let persisted = false;
  const ok = await sendGlobalFixedWhatsappReply({
    conversationId: 4,
    to: '5511999999999',
    inboundMetaMessageId: 'wamid.inbound',
    send: async () => ({ success: false, code: 503 }),
    persist: async () => { persisted = true; },
  });
  assert.equal(ok, false);
  assert.equal(persisted, false);
});

test('switch is opt-in and webhook sends the reply before handoff and other shortcuts for text and media', () => {
  const previous = process.env.NETIV_GLOBAL_FIXED_REPLY_ENABLED;
  try {
    delete process.env.NETIV_GLOBAL_FIXED_REPLY_ENABLED;
    assert.equal(isGlobalFixedWhatsappReplyEnabled(), false);
    process.env.NETIV_GLOBAL_FIXED_REPLY_ENABLED = 'true';
    assert.equal(isGlobalFixedWhatsappReplyEnabled(), true);
  } finally {
    if (previous === undefined) delete process.env.NETIV_GLOBAL_FIXED_REPLY_ENABLED;
    else process.env.NETIV_GLOBAL_FIXED_REPLY_ENABLED = previous;
  }
  let webhook: string;
  try {
    webhook = readFileSync(new URL('../services/webhookProcessor.ts', import.meta.url), 'utf8');
  } catch {
    webhook = readFileSync(new URL('../services/webhookProcessor.js', import.meta.url), 'utf8');
  }
  const sends = [...webhook.matchAll(/if \(globalFixedReplyEnabled\) \{\s+await sendGlobalFixedWhatsappReply/g)];
  assert.equal(sends.length, 2);
  assert.ok(webhook.indexOf('await sendGlobalFixedWhatsappReply') < webhook.indexOf('await shouldBlockAnaWebhookAutomation'));
  assert.ok(webhook.lastIndexOf('await sendGlobalFixedWhatsappReply') < webhook.lastIndexOf('await shouldBlockAnaWebhookAutomation'));
});

test('switch suppresses other pending Ana replies while active', async () => {
  const previous = process.env.NETIV_GLOBAL_FIXED_REPLY_ENABLED;
  try {
    process.env.NETIV_GLOBAL_FIXED_REPLY_ENABLED = 'true';
    const result = await sendAnaTextMessageWithQuota({
      conversationId: 4,
      to: '5511999999999',
      text: 'Outra resposta automática',
      phase: 'ana_test',
    });
    assert.equal(result.success, false);
    assert.equal(result.error, 'global_fixed_reply_active');
  } finally {
    if (previous === undefined) delete process.env.NETIV_GLOBAL_FIXED_REPLY_ENABLED;
    else process.env.NETIV_GLOBAL_FIXED_REPLY_ENABLED = previous;
  }
});
