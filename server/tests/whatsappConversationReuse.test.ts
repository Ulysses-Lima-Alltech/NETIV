import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../repositories/conversationRepository.js', import.meta.url), 'utf8');
const findOrCreateSource = source.slice(
  source.indexOf('export async function findOrCreateConversation'),
  source.indexOf('async function clearNonHandoffAssignedBroker')
);

test('WhatsApp reutiliza conversa aberta por contato/telefone antes de criar nova', () => {
  assert.match(source, /findOrCreateContactByPhone\(\{/);
  assert.match(source, /phoneE164: normalizedPhone/);
  assert.match(source, /manual_closed_at IS NULL/);
  assert.match(source, /COALESCE\(classification, ''\) <> 'Carteira'/);
  assert.match(source, /contact_id = \$2/);
  assert.match(source, /regexp_replace\(COALESCE\(contact_phone, ''\), '\\D', '', 'g'\) = \$3/);
  assert.match(source, /regexp_replace\(COALESCE\(external_contact_id, ''\), '\\D', '', 'g'\) = \$3/);
  assert.match(source, /ORDER BY last_message_at DESC NULLS LAST, updated_at DESC, id DESC/);
  assert.match(source, /\[WHATSAPP_CONVERSATION_REUSE_BY_CONTACT\]/);
});

test('WhatsApp detecta duplicidade aberta e cria nova quando so existem fechadas', () => {
  assert.match(source, /\[WHATSAPP_DUPLICATE_OPEN_CONVERSATIONS_DETECTED\]/);
  assert.match(source, /conversationIds: openRows\.rows\.map\(\(row\) => row\.id\)/);
  assert.match(
    source,
    /insertExternalId = `\$\{effectiveExternalId\}:\$\{Date\.now\(\)\.toString\(36\)\}-\$\{process\.hrtime\.bigint\(\)\.toString\(36\)\}`/
  );
  assert.match(source, /\[WHATSAPP_CONVERSATION_CREATED_FOR_CONTACT\]/);
});

test('conversationId logado vem do RETURNING persistido e segue para mensagem e Ana', () => {
  const webhook = readFileSync(new URL('../services/webhookProcessor.js', import.meta.url), 'utf8');
  assert.match(source, /RETURNING \*/);
  assert.match(source, /const conv = rows\[0\]/);
  assert.match(webhook, /conversationIdForCatch = conv\.id/);
  assert.match(webhook, /find_or_create_conversation_success'[\s\S]*conversationId: conv\.id/);
  assert.match(webhook, /insertMessage\(conv\.id, 'user'/);
  assert.match(webhook, /scheduleWhatsAppAiAfterUserMessage\(conv\.id/);
  assert.doesNotMatch(findOrCreateSource, /classification = 'Handoff'/);
  assert.doesNotMatch(findOrCreateSource, /handoff = true/);
});
