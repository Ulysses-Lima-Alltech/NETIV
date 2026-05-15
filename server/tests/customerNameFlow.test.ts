import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { ConversationRow } from '../repositories/conversationRepository.js';
import { buildLeadPayload } from '../services/djangoWebhook.js';
import {
  resolveOperationalCustomerNameParts,
  resolveSafeDisplayName,
} from '../utils/customerNameResolver.js';
import { extractCustomerNameFromUserUtterance } from '../utils/extractCustomerNameFromMessage.js';

function conversationFixture(patch: Partial<ConversationRow> = {}): ConversationRow {
  return {
    id: 1,
    channel: 'whatsapp',
    external_contact_id: '5511999999999',
    contact_phone: '5511999999999',
    customer_name: null,
    whatsapp_display_name: null,
    ana_asked_customer_name: false,
    enterprise_id: 10,
    classification: 'Novo',
    lead_temperature: null,
    handoff: false,
    meta_phone_number_id: null,
    last_message_at: null,
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    updated_at: new Date('2026-01-01T00:00:00.000Z'),
    ...patch,
  };
}

test('resolvedor operacional respeita ordem oficial e safeDisplayName não cai em Cliente com nome disponível', () => {
  const ordered = resolveOperationalCustomerNameParts({
    conversationCustomerName: 'Carlos Silva',
    whatsappDisplayName: 'Carlos WA',
    contactFullName: 'Carlos Contato',
    contactFirstName: 'Carlos',
    phone: '5511999999999',
  });
  assert.equal(ordered.value, 'Carlos Silva');
  assert.equal(ordered.source, 'conversation_customer_name');

  const displayOnly = resolveSafeDisplayName({
    conversationCustomerName: null,
    whatsappDisplayName: 'Duda Perfil',
    contactFullName: null,
    contactFirstName: null,
    phone: '5511988887777',
  });
  assert.equal(displayOnly, 'Duda Perfil');
});

test('extractCustomerNameFromUserUtterance captura autoidentificação explícita', () => {
  const name = extractCustomerNameFromUserUtterance('me chamo Carlos');
  assert.equal(name, 'Carlos');
});

test('buildLeadPayload usa cascata de nome até first_name antes de telefone', () => {
  const fromDisplay = buildLeadPayload(
    conversationFixture({ customer_name: null, whatsapp_display_name: 'Nome Perfil' }),
    { contactFullName: 'Nome Contato', contactFirstName: 'Nome' }
  ) as { name: string };
  assert.equal(fromDisplay.name, 'Nome Perfil');

  const fromContactFull = buildLeadPayload(
    conversationFixture({ customer_name: null, whatsapp_display_name: null }),
    { contactFullName: 'Contato Completo', contactFirstName: 'Contato' }
  ) as { name: string };
  assert.equal(fromContactFull.name, 'Contato Completo');

  const fromContactFirst = buildLeadPayload(
    conversationFixture({ customer_name: null, whatsapp_display_name: null }),
    { contactFullName: null, contactFirstName: 'PrimeiroNome' }
  ) as { name: string };
  assert.equal(fromContactFirst.name, 'PrimeiroNome');

  const fromPhone = buildLeadPayload(
    conversationFixture({
      customer_name: null,
      whatsapp_display_name: null,
      contact_phone: '5511987654321',
      external_contact_id: '5511987654321',
    }),
    { contactFullName: null, contactFirstName: null }
  ) as { name: string };
  assert.equal(fromPhone.name, '11987654321');
});

test('wiring mínimo: sync de contato não sobrescreve nome existente e agendamento usa resolvedor', () => {
  const contactsRepoSource = readFileSync(new URL('../repositories/contactsRepository.js', import.meta.url), 'utf8');
  assert.match(contactsRepoSource, /SET full_name = CASE/);
  assert.match(contactsRepoSource, /WHEN full_name IS NULL OR trim\(full_name\) = '' THEN \$2/);

  const apptSource = readFileSync(new URL('../services/anaAppointmentFromChatService.js', import.meta.url), 'utf8');
  assert.match(apptSource, /resolveOperationalCustomerNameParts/);
  assert.doesNotMatch(apptSource, /customerName:\s*args\.customerName\s*\|\|\s*['"]Cliente['"]/);
});
