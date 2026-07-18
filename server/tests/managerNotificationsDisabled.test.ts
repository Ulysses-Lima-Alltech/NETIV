import assert from 'node:assert/strict';
import test from 'node:test';
import {
  areManagerNotificationsEnabled,
  canReceiveBrokerOperationalNotification,
  MANAGER_NOTIFICATIONS_ENV_NAME,
} from '../config/managerNotificationPolicy.js';
import { readServerSourceFile, readWorkspaceFile } from './helpers/serverSourceResolver.js';

const tokenRepository = readServerSourceFile('repositories/mobileDeviceTokenRepository.ts');
const pushService = readServerSourceFile('services/brokerPushNotificationService.ts');
const whatsappService = readServerSourceFile('services/brokerWhatsappNotificationService.ts');
const assignmentService = readServerSourceFile('services/brokerAssignmentService.ts');
const appointmentService = readServerSourceFile('services/anaAppointmentFromChatService.ts');
const conversationEngine = readServerSourceFile('services/conversationEngine.ts');
const serverEnvExample = readServerSourceFile('.env.example');
const workspaceEnvExample = readWorkspaceFile('.env.example');

test('MANAGER_NOTIFICATIONS_ENABLED e opt-in e usa false como padrao', () => {
  assert.equal(MANAGER_NOTIFICATIONS_ENV_NAME, 'MANAGER_NOTIFICATIONS_ENABLED');
  assert.equal(areManagerNotificationsEnabled({}), false);
  assert.equal(areManagerNotificationsEnabled({ MANAGER_NOTIFICATIONS_ENABLED: '' }), false);
  assert.equal(areManagerNotificationsEnabled({ MANAGER_NOTIFICATIONS_ENABLED: 'false' }), false);
  assert.equal(areManagerNotificationsEnabled({ MANAGER_NOTIFICATIONS_ENABLED: 'unexpected' }), false);
  assert.equal(areManagerNotificationsEnabled({ MANAGER_NOTIFICATIONS_ENABLED: 'true' }), true);
  assert.match(serverEnvExample, /MANAGER_NOTIFICATIONS_ENABLED=false/);
  assert.match(workspaceEnvExample, /MANAGER_NOTIFICATIONS_ENABLED=false/);
});

test('novo atendimento nao seleciona token de gestor quando a flag esta ausente ou false', () => {
  assert.equal(canReceiveBrokerOperationalNotification('GESTOR', {}), false);
  assert.equal(
    canReceiveBrokerOperationalNotification('GESTOR', { MANAGER_NOTIFICATIONS_ENABLED: 'false' }),
    false
  );
  assert.equal(canReceiveBrokerOperationalNotification('CORRETOR', {}), true);
  assert.match(tokenRepository, /canReceiveBrokerOperationalNotification\('GESTOR'\)/);
  assert.match(tokenRepository, /mu\.role = 'CORRETOR'/);
  assert.match(tokenRepository, /\$2::boolean = true AND mu\.role = 'GESTOR'/);
  assert.match(tokenRepository, /\[brokerId, managerNotificationsEnabled\]/);
});

test('bloqueio de gestor ocorre antes de payload, persistencia e chamada externa de push', () => {
  const roleFilterIndex = tokenRepository.indexOf("mu.role = 'CORRETOR'");
  const payloadIndex = pushService.indexOf('const payload =');
  const fetchIndex = pushService.indexOf('fetch(EXPO_PUSH_ENDPOINT');
  assert.ok(roleFilterIndex >= 0);
  assert.ok(payloadIndex >= 0);
  assert.ok(fetchIndex > payloadIndex);
  assert.doesNotMatch(tokenRepository, /INSERT INTO .*notification/i);
  assert.doesNotMatch(tokenRepository, /enqueue|addJob|publish/i);
});

test('ausencia de corretor nao cria fallback nem chama WhatsApp ou push para gestor', () => {
  assert.match(assignmentService, /assignedBrokerId != null\s*&&\s*!PENDING_ATTENDANCE_TEMPLATE_SENT_BY_CALLER_REASONS/);
  assert.match(assignmentService, /markConversationAsHandoffUnassigned/);
  assert.doesNotMatch(assignmentService, /GESTOR|MANAGERIAL|notifyManager|managerNotification/i);
  assert.doesNotMatch(conversationEngine, /brokerPhone:\s*.*manager|brokerId:\s*.*manager/i);
  assert.doesNotMatch(whatsappService, /GESTOR|MANAGERIAL|notifyManager|managerNotification/i);
});

test('novo agendamento sem corretor nao notifica gestor nem cria envio pendente', () => {
  const noBrokerGuard = conversationEngine.indexOf('if (assignedBrokerId == null) {', conversationEngine.indexOf("SKIPPED_NO_BROKER") - 500);
  const appointmentTemplateSend = conversationEngine.indexOf('await sendBrokerAppointmentConfirmedTemplate({');
  assert.ok(noBrokerGuard >= 0);
  assert.ok(appointmentTemplateSend > noBrokerGuard);
  assert.match(conversationEngine, /BROKER_APPOINTMENT_CONFIRMED_TEMPLATE_SKIPPED_NO_BROKER/);
  assert.match(conversationEngine, /sendBrokerAppointmentConfirmedTemplate\(\{/);
  assert.doesNotMatch(appointmentService, /GESTOR|MANAGERIAL|notifyManager|managerNotification/i);
  assert.doesNotMatch(whatsappService, /gestor_agendamento|manager.*appointment/i);
});

test('canais preservados continuam enderecados ao corretor responsavel e ao cliente', () => {
  assert.equal(canReceiveBrokerOperationalNotification('CORRETOR', {}), true);
  assert.match(pushService, /listActiveMobileDeviceTokensByBrokerId\(args\.brokerId\)/);
  assert.match(whatsappService, /sendTemplateMessageByName\(\s*brokerPhone,/);
  assert.match(conversationEngine, /sendTextMessage\(\{/);
  assert.match(conversationEngine, /sendBrokerPendingAttendancePush\(\{/);
  assert.match(conversationEngine, /sendBrokerAppointmentConfirmedTemplate\(\{/);
});

test('nao existe canal de email ou job de notificacao destinado ao gestor', () => {
  const notificationSources = [pushService, whatsappService, assignmentService, conversationEngine].join('\n');
  assert.doesNotMatch(notificationSources, /sendMail|sendEmail|nodemailer|managerNotification|notifyManager/i);
  assert.doesNotMatch(notificationSources, /gestor_atendimento|gestor_agendamento/i);
  assert.doesNotMatch(notificationSources, /enqueueManager|manager.*job|job.*manager/i);
});
