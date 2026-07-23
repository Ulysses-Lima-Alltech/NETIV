import { readServerSourceFile } from './helpers/serverSourceResolver.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mapConversationRealtimeRow,
  type ConversationRealtimeRow,
} from '../realtime/realtimePublisher.js';

function rowWithConversationType(conversationType: string | null): ConversationRealtimeRow {
  const now = new Date('2026-07-14T12:00:00.000Z');
  return {
    id: 10,
    channel: 'whatsapp',
    external_contact_id: '5511999990000',
    contact_phone: '5511999990000',
    customer_name: null,
    whatsapp_display_name: null,
    enterprise_id: null,
    enterprise_name: null,
    classification: 'Novo',
    lead_temperature: null,
    handoff: false,
    created_at: now,
    updated_at: now,
    last_message_at: null,
    last_message_preview: null,
    reserve_reason: null,
    reserve_desired_city: null,
    reserve_price_min: null,
    reserve_price_max: null,
    reserve_property_type: null,
    reserve_bedrooms: null,
    reserve_interest_type: null,
    reserve_follow_up_moment: null,
    reserve_commercial_notes: null,
    assigned_broker_id: null,
    assigned_broker_name: null,
    broker_notification_status: null,
    broker_push_notification_status: null,
    conversation_type: conversationType,
    manual_closed_at: null,
    manual_closed_by_user_id: null,
    manual_closed_reason: null,
    reengagement_count: null,
  };
}

test('realtime publica o tipo da conversa e aplica fallback CLIENT', () => {
  assert.equal(mapConversationRealtimeRow(rowWithConversationType('ADMIN')).conversationType, 'ADMIN');
  assert.equal(mapConversationRealtimeRow(rowWithConversationType('CORRETOR')).conversationType, 'CORRETOR');
  assert.equal(mapConversationRealtimeRow(rowWithConversationType(null)).conversationType, 'CLIENT');
});

test('publishConversationUpdated continua protegido por try/catch', () => {
  const source = readServerSourceFile('realtime/realtimePublisher.ts');
  assert.match(source, /export async function publishConversationUpdated/);
  assert.match(source, /\[Realtime\] publishConversationUpdated_failed/);
});
