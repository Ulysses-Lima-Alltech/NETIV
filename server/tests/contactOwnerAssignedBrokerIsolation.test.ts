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

test('conversationRepository nao dispara syncConversationOwnerFromContact e limpa assigned_broker indevido em modo ANA', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'repositories/conversationRepository.ts'), 'utf8');
  assert.doesNotMatch(source, /syncConversationOwnerFromContact/);
  assert.match(source, /clearNonHandoffAssignedBroker/);
  assert.match(source, /COALESCE\(conv\.handoff,\s*false\)\s*=\s*false/);
  assert.match(source, /COALESCE\(conv\.classification,\s*''\)\s*<>\s*'Handoff'/);
});

test('reasons legitimas de atribuicao de corretor continuam permitidas', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'services/brokerAssignmentService.ts'), 'utf8');
  assert.match(source, /explicit_broker_request/);
  assert.match(source, /pending_resolution_broker_choice/);
  assert.match(source, /manual_classification_handoff/);
});
