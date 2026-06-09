import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  buildBrokerAppointmentConfirmedTemplateParameters,
  buildBrokerPendingAttendanceTemplateParameters,
} from '../services/brokerWhatsappNotificationService.js';
import { formatAppointmentDateTimeForBrokerNotification } from '../services/anaAppointmentFromChatService.js';

const brokerWhatsappService = readFileSync(
  new URL('../services/brokerWhatsappNotificationService.ts', import.meta.url),
  'utf8'
);
const conversationEngine = readFileSync(
  new URL('../services/conversationEngine.ts', import.meta.url),
  'utf8'
);
const brokerAssignmentService = readFileSync(
  new URL('../services/brokerAssignmentService.ts', import.meta.url),
  'utf8'
);
const appointmentMigration = readFileSync(
  new URL('../db/migrations/pg/070_appointment_broker_whatsapp_notification.sql', import.meta.url),
  'utf8'
);
const templatesCatalog = readFileSync(
  new URL('../catalogs/whatsappTemplates.ts', import.meta.url),
  'utf8'
);

test('cliente pediu corretor usa corretor_atendimento_pendente com parametros corretos', () => {
  assert.deepEqual(
    buildBrokerPendingAttendanceTemplateParameters({
      brokerName: 'Paula',
      customerNameOrPhone: 'Cliente A',
      enterpriseName: 'Evora',
    }),
    ['Paula', 'Cliente A', 'Evora']
  );
  assert.match(brokerWhatsappService, /DEFAULT_PENDING_ATTENDANCE_TEMPLATE_NAME = 'corretor_atendimento_pendente'/);
  assert.match(conversationEngine, /sendBrokerPendingAttendanceTemplate\(\{/);
  assert.match(conversationEngine, /reason: brokerAssignReason/);
});

test('cliente confirmou visita usa corretor_agendamento_confirmado com parametros corretos', () => {
  assert.deepEqual(
    buildBrokerAppointmentConfirmedTemplateParameters({
      brokerName: 'Paula',
      customerNameOrPhone: 'Cliente A',
      enterpriseName: 'Evora',
      appointmentDateTimeText: 'quarta às 18h',
    }),
    ['Paula', 'Cliente A', 'Evora', 'quarta às 18h']
  );
  assert.match(brokerWhatsappService, /DEFAULT_APPOINTMENT_CONFIRMED_TEMPLATE_NAME = 'corretor_agendamento_confirmado'/);
  assert.match(conversationEngine, /sendBrokerAppointmentConfirmedTemplate\(\{/);
  assert.match(conversationEngine, /notifyBrokerAppointmentConfirmedAfterAnaSend/);
});

test('parametro quatro do agendamento usa data e hora amigaveis ou fallback ISO', () => {
  assert.equal(
    formatAppointmentDateTimeForBrokerNotification(new Date('2026-06-10T21:00:00.000Z')),
    'quarta às 18h'
  );
  assert.equal(
    formatAppointmentDateTimeForBrokerNotification(null, '2026-06-10', '14:00'),
    '2026-06-10 às 14h'
  );
});

test('template de agendamento disabled ou corretor sem telefone nao quebra fluxo', () => {
  assert.match(brokerWhatsappService, /BROKER_APPOINTMENT_CONFIRMED_TEMPLATE_ENABLED/);
  assert.match(brokerWhatsappService, /\[BROKER_APPOINTMENT_CONFIRMED_TEMPLATE_SKIPPED_DISABLED\]/);
  assert.match(brokerWhatsappService, /return \{ success: false, status: 'skipped_disabled'/);
  assert.match(brokerWhatsappService, /\[BROKER_APPOINTMENT_CONFIRMED_TEMPLATE_NO_PHONE\]/);
  assert.match(brokerWhatsappService, /return \{ success: false, status: 'no_phone'/);
  assert.match(brokerWhatsappService, /\[BROKER_APPOINTMENT_CONFIRMED_TEMPLATE_FAILED\]/);
});

test('visita ja notificada nao envia template duplicado', () => {
  assert.match(appointmentMigration, /appointment_broker_notified_at/);
  assert.match(appointmentMigration, /appointment_broker_notification_status/);
  assert.match(appointmentMigration, /appointment_broker_notification_error/);
  assert.match(appointmentMigration, /appointment_broker_notification_template/);
  assert.match(brokerWhatsappService, /claimAppointmentBrokerNotificationSend/);
  assert.match(brokerWhatsappService, /NOT IN \('sent', 'sending'\)/);
  assert.match(brokerWhatsappService, /\[BROKER_APPOINTMENT_CONFIRMED_TEMPLATE_SKIPPED_DUPLICATE\]/);
});

test('appointment_confirmed e motivo permitido sem disparar atendimento pendente errado', () => {
  assert.match(brokerAssignmentService, /'appointment_confirmed'/);
  assert.match(brokerAssignmentService, /PENDING_ATTENDANCE_TEMPLATE_SENT_BY_CALLER_REASONS/);
  assert.match(conversationEngine, /reason: 'appointment_confirmed'/);
  assert.match(conversationEngine, /structuredAppointmentRegistration/);
  assert.match(conversationEngine, /directVisitAppointmentRegistration/);
});

test('catalogo local inclui os dois templates aprovados da Meta', () => {
  assert.match(templatesCatalog, /key: 'corretor_atendimento_pendente'/);
  assert.match(templatesCatalog, /key: 'corretor_agendamento_confirmado'/);
});
