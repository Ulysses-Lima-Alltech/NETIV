import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  GLOBAL_FIXED_WHATSAPP_REPLY,
  isGlobalFixedWhatsappReplyEnabled,
  NETIV_GLOBAL_FIXED_REPLY_ENABLED_ENV,
  sendGlobalFixedWhatsappReply,
} from '../services/globalFixedWhatsappReply.js';
import { sendAnaTextMessageWithQuota } from '../services/anaOutboundQuotaService.js';

function readWebhookSource(): string {
  try {
    return readFileSync(new URL('../services/webhookProcessor.ts', import.meta.url), 'utf8');
  } catch {
    return readFileSync(new URL('../services/webhookProcessor.js', import.meta.url), 'utf8');
  }
}

test('global reply usa exatamente o texto de duas linhas e persiste outbound', async () => {
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
  assert.equal(
    GLOBAL_FIXED_WHATSAPP_REPLY,
    'Olá, que bom ter você por aqui !\nEm breve um dos nossos consultores entrará em contato para passar as informações do empreendimento'
  );
});

test('falha de envio registra falha e nao persiste reply', async () => {
  let persisted = false;

  const ok = await sendGlobalFixedWhatsappReply({
    conversationId: 4,
    to: '5511999999999',
    inboundMetaMessageId: 'wamid.inbound',
    send: async () => ({ success: false, code: 503 }),
    persist: async () => {
      persisted = true;
    },
  });

  assert.equal(ok, false);
  assert.equal(persisted, false);
});

test('switch e opt-in: texto do fixed reply resolve/classifica oliva317 antes de responder', () => {
  const previous = process.env[NETIV_GLOBAL_FIXED_REPLY_ENABLED_ENV];
  try {
    delete process.env[NETIV_GLOBAL_FIXED_REPLY_ENABLED_ENV];
    assert.equal(isGlobalFixedWhatsappReplyEnabled(), false);
    process.env[NETIV_GLOBAL_FIXED_REPLY_ENABLED_ENV] = 'true';
    assert.equal(isGlobalFixedWhatsappReplyEnabled(), true);
  } finally {
    if (previous === undefined) delete process.env[NETIV_GLOBAL_FIXED_REPLY_ENABLED_ENV];
    else process.env[NETIV_GLOBAL_FIXED_REPLY_ENABLED_ENV] = previous;
  }

  const webhook = readWebhookSource();
  const fixedReplyCalls = [...webhook.matchAll(/if \(globalFixedReplyEnabled\) \{\s+await sendGlobalFixedWhatsappReply/g)];
  assert.equal(fixedReplyCalls.length, 1);
  assert.ok(webhook.indexOf('await sendGlobalFixedWhatsappReply') < webhook.indexOf('await shouldBlockAnaWebhookAutomation'));

  const textFixedBranch = webhook.slice(
    webhook.indexOf('if (globalFixedReplyEnabled) {', webhook.indexOf("const text = effectiveText")),
    webhook.indexOf('if (await shouldBlockAnaWebhookAutomation', webhook.indexOf("const text = effectiveText")),
  );
  assert.match(textFixedBranch, /conv = await resolveAnaEnterpriseBeforeEngine/);
  assert.match(textFixedBranch, /if \(conv\.enterprise_id === OLIVA317_ENTERPRISE_ID\) \{\s+await classifyLeadForInboundText/);
  assert.ok(textFixedBranch.indexOf('conv = await resolveAnaEnterpriseBeforeEngine') < textFixedBranch.indexOf('await classifyLeadForInboundText'));
  assert.ok(textFixedBranch.indexOf('await classifyLeadForInboundText') < textFixedBranch.indexOf('await sendGlobalFixedWhatsappReply'));
  assert.ok(textFixedBranch.indexOf('await sendGlobalFixedWhatsappReply') < textFixedBranch.indexOf('continue;'));
});

test('switch suprime outros envios automaticos da Ana enquanto ativo', async () => {
  const previous = process.env[NETIV_GLOBAL_FIXED_REPLY_ENABLED_ENV];
  try {
    process.env[NETIV_GLOBAL_FIXED_REPLY_ENABLED_ENV] = 'true';
    const result = await sendAnaTextMessageWithQuota({
      conversationId: 4,
      to: '5511999999999',
      text: 'Outra resposta automatica',
      phase: 'ana_test',
    });
    assert.equal(result.success, false);
    assert.equal(result.error, 'global_fixed_reply_active');
  } finally {
    if (previous === undefined) delete process.env[NETIV_GLOBAL_FIXED_REPLY_ENABLED_ENV];
    else process.env[NETIV_GLOBAL_FIXED_REPLY_ENABLED_ENV] = previous;
  }
});
