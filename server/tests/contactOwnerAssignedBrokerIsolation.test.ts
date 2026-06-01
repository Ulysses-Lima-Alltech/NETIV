import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';

test('assignContactToConversation vincula apenas contact_id (sem copiar owner para assigned_broker)', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'repositories/contactsRepository.ts'), 'utf8');
  assert.match(source, /UPDATE conversations[\s\S]*SET contact_id = \$2,[\s\S]*updated_at = NOW\(\)/);
  assert.doesNotMatch(source, /assignContactToConversation[\s\S]*assigned_broker_id\s*=/);
});

test('syncConversationOwnerFromContact e syncAllConversationOwnersFromContacts nao copiam owner para assigned_broker', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'repositories/contactsRepository.ts'), 'utf8');
  assert.doesNotMatch(source, /SET assigned_broker_id = c\.owner_user_id/);
  assert.match(source, /\[CONTACT_OWNER_NOT_COPIED_TO_CONVERSATION_ASSIGNED_BROKER\]/);
});

test('setContactOwnerAdmin nao atualiza assigned_broker_id das conversas', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'repositories/contactsRepository.ts'), 'utf8');
  assert.doesNotMatch(source, /setContactOwnerAdmin[\s\S]*UPDATE conversations SET assigned_broker_id =/);
});

test('conversationRepository nao dispara syncConversationOwnerFromContact e leitura nao depende de cleanup', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'repositories/conversationRepository.ts'), 'utf8');
  assert.doesNotMatch(source, /syncConversationOwnerFromContact/);
  assert.match(source, /clearNonHandoffAssignedBroker/);
  assert.match(source, /safeClearNonHandoffAssignedBroker/);
  assert.match(source, /COALESCE\(conv\.handoff,\s*false\)\s*=\s*false/);
  assert.match(source, /COALESCE\(conv\.classification,\s*''\)\s*<>\s*'Handoff'/);
  assert.doesNotMatch(source, /getConversationById[\s\S]*await clearNonHandoffAssignedBroker/);
  assert.doesNotMatch(source, /getConversationById[\s\S]*await safeClearNonHandoffAssignedBroker/);
  assert.doesNotMatch(source, /getConversationWithPreviewById[\s\S]*await clearNonHandoffAssignedBroker/);
  assert.doesNotMatch(source, /getConversationWithPreviewById[\s\S]*await safeClearNonHandoffAssignedBroker/);
});

test('reasons legitimas de atribuicao de corretor continuam permitidas', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'services/brokerAssignmentService.ts'), 'utf8');
  assert.match(source, /explicit_broker_request/);
  assert.match(source, /pending_resolution_broker_choice/);
  assert.match(source, /manual_classification_handoff/);
});

test('GET messages tem logs por etapa e retorno de falha com step', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'routes/whatsapp.ts'), 'utf8');
  assert.match(source, /\[WHATSAPP_GET_MESSAGES_START\]/);
  assert.match(source, /\[WHATSAPP_GET_MESSAGES_CONVERSATION_LOADED\]/);
  assert.match(source, /\[WHATSAPP_GET_MESSAGES_MESSAGES_LOADED\]/);
  assert.match(source, /\[WHATSAPP_GET_MESSAGES_WINDOW_LOADED\]/);
  assert.match(source, /\[WHATSAPP_GET_MESSAGES_FAILED\]/);
  assert.match(source, /step = 'load_conversation'/);
  assert.match(source, /step = 'load_messages'/);
  assert.match(source, /step = 'load_window'/);
});

test('payloads mascaram corretor fora de handoff no mapper e no PATCH classification', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'routes/whatsapp.ts'), 'utf8');
  assert.match(source, /assignedBrokerName:\s*isHandoff\s*\?/);
  assert.match(source, /assignedBrokerId:\s*isHandoff\s*\?/);
  assert.match(source, /brokerNotificationStatus:\s*isHandoff\s*\?/);
  assert.match(source, /brokerPushNotificationStatus:\s*isHandoff\s*\?/);
});
