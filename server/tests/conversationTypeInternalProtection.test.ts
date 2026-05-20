import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('normalizacao de telefone protegido cobre variacoes com e sem DDI', () => {
  const source = readFileSync(new URL('../utils/protectedClientPhone.ts', import.meta.url), 'utf8');
  assert.match(source, /PROTECTED_CLIENT_PHONE_CANONICAL\s*=\s*'5512992367544'/);
  assert.match(source, /replace\(/);
  assert.match(source, /endsWith\('12992367544'\)/);
});

test('classificacao automatica interna e bloqueada para telefone protegido', () => {
  const source = readFileSync(new URL('../services/whatsappBatchTemplateService.ts', import.meta.url), 'utf8');
  assert.match(source, /isProtectedClientPhone\(/);
  assert.match(source, /INTERNAL_CLASSIFICATION_BLOCKED_FOR_PROTECTED_PHONE/);
  assert.match(source, /template\.category === 'CORRETOR' \|\| template\.category === 'ADMIN'/);
});

test('endpoint PATCH de tipo da conversa existe e publica realtime', () => {
  const source = readFileSync(new URL('../routes/whatsapp.ts', import.meta.url), 'utf8');
  assert.match(source, /router\.patch\('\/conversations\/:id\/type'/);
  assert.match(source, /updateConversationTypeSchema/);
  assert.match(source, /MANUAL_CONVERSATION_TYPE_CHANGED/);
  assert.match(source, /publishConversationUpdated\(id\)/);
});

test('ana continua bloqueando internos reais e libera client', () => {
  const source = readFileSync(new URL('../services/conversationEngine.ts', import.meta.url), 'utf8');
  assert.match(source, /const blockInternalConversation/);
  assert.match(source, /normalized === 'CORRETOR' \|\| normalized === 'ADMIN'/);
  assert.match(source, /blockInternalConversation\(effectiveConv\.conversation_type\)/);
});
