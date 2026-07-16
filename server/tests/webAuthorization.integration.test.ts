import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createServer, type Server } from 'node:http';
import { after, before, beforeEach, test } from 'node:test';
import express from 'express';
import { io as createSocketClient, type Socket } from 'socket.io-client';
import apiRouter from '../routes/index.js';
import { createSession, createUser, getSessionUser } from '../repositories/userRepository.js';
import { getPool } from '../db/pg.js';
import { closeSocketServerForTests, initSocketServer } from '../realtime/socketServer.js';
import { publishAccessControlledRealtimeEvent } from '../realtime/realtimePublisher.js';
import {
  emitWhatsAppEvent,
  getSseConnectionCountForTests,
  registerWhatsAppEventsSse,
} from '../services/whatsappEvents.js';
import { resetRateLimitForTests } from '../middleware/rateLimit.js';
import { createIntegrationPool, resetAuthIntegrationData } from './helpers/authIntegrationDb.js';

const pool = createIntegrationPool();
const integrationTest = pool ? test : test.skip;
let server: Server | null = null;
let baseUrl = '';

type Fixture = Awaited<ReturnType<typeof createFixture>>;

if (pool) {
  before(async () => {
    const app = express();
    app.use(express.json());
    app.use('/api', apiRouter);
    server = createServer(app);
    initSocketServer(server);
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });
  beforeEach(async () => {
    resetRateLimitForTests();
    await resetAuthIntegrationData(pool);
  });
  after(async () => {
    await closeSocketServerForTests();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await pool.end();
    await getPool().end();
  });
}

async function request(path: string, token: string, init: RequestInit = {}) {
  return fetch(`${baseUrl}/api${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
}

async function createFixture() {
  const password = 'integration-password-123';
  const admin = await createUser({ username: 'admin.test', name: 'Admin', password, role: 'ADMIN', active: true });
  const managerA = await createUser({ username: 'manager.a', name: 'Manager A', password, role: 'MANAGERIAL', active: true });
  const managerB = await createUser({ username: 'manager.b', name: 'Manager B', password, role: 'MANAGERIAL', active: true });
  const collaboratorA = await createUser({ username: 'collab.a', name: 'Collaborator A', password, role: 'COLLABORATOR', active: true });
  const collaboratorB = await createUser({ username: 'collab.b', name: 'Collaborator B', password, role: 'COLLABORATOR', active: true });
  const enterprises = await pool!.query<{ id: number }>(`
    INSERT INTO enterprises(name,slug) VALUES ('Enterprise A','enterprise-a'),('Enterprise B','enterprise-b') RETURNING id`);
  const brokers = await pool!.query<{ id: number }>(`
    INSERT INTO corretores(full_name,city,phone,real_estate_agency) VALUES
      ('Broker A','A','551100000001','Agency A'),('Broker B','B','551100000002','Agency B') RETURNING id`);
  const [enterpriseA, enterpriseB] = enterprises.rows.map((row) => Number(row.id));
  const [brokerA, brokerB] = brokers.rows.map((row) => Number(row.id));
  await pool!.query(`INSERT INTO corretor_empreendimentos(corretor_id,enterprise_id) VALUES ($1,$2),($3,$4)`, [brokerA, enterpriseA, brokerB, enterpriseB]);
  const contacts = await pool!.query<{ id: number }>(`
    INSERT INTO contacts(full_name,phone_e164,enterprise_id,owner_user_id) VALUES
      ('Lead A','+5511999000001',$1,$2),('Lead B','+5511999000002',$3,$4) RETURNING id`,
    [enterpriseA, brokerA, enterpriseB, brokerB]);
  const [contactA, contactB] = contacts.rows.map((row) => Number(row.id));
  const conversations = await pool!.query<{ id: number }>(`
    INSERT INTO conversations(channel,external_contact_id,contact_phone,customer_name,enterprise_id,assigned_broker_id,contact_id,last_message_at)
    VALUES ('whatsapp','scope-a','5511999000001','Lead A',$1,$2,$3,NOW()),
           ('whatsapp','scope-b','5511999000002','Lead B',$4,$5,$6,NOW()) RETURNING id`,
    [enterpriseA, brokerA, contactA, enterpriseB, brokerB, contactB]);
  const [conversationA, conversationB] = conversations.rows.map((row) => Number(row.id));
  await pool!.query(`INSERT INTO messages(conversation_id,role,content) VALUES ($1,'user','Message A'),($2,'user','Message B')`, [conversationA, conversationB]);
  const appointments = await pool!.query<{ id: number }>(`
    INSERT INTO appointments(customer_name,customer_phone,enterprise_id,broker_id,city,start_at,end_at,conversation_id)
    VALUES ('Visit A','5511999000001',$1,$2,'A',NOW()+INTERVAL '1 day',NOW()+INTERVAL '1 day 1 hour',$3),
           ('Visit B','5511999000002',$4,$5,'B',NOW()+INTERVAL '2 day',NOW()+INTERVAL '2 day 1 hour',$6) RETURNING id`,
    [enterpriseA, brokerA, conversationA, enterpriseB, brokerB, conversationB]);
  const [appointmentA, appointmentB] = appointments.rows.map((row) => Number(row.id));

  await pool!.query(`INSERT INTO app_user_management(collaborator_user_id,manager_user_id,created_by_user_id) VALUES ($1,$2,$3),($4,$5,$3)`,
    [collaboratorA.id, managerA.id, admin.id, collaboratorB.id, managerB.id]);
  for (const [userId, entId, brokerId, convId, contactId, appointmentId, source, assignedBy] of [
    [managerA.id, enterpriseA, brokerA, conversationA, contactA, appointmentA, 'ADMIN_DIRECT', admin.id],
    [managerB.id, enterpriseB, brokerB, conversationB, contactB, appointmentB, 'ADMIN_DIRECT', admin.id],
    [collaboratorA.id, enterpriseA, brokerA, conversationA, contactA, appointmentA, 'MANAGER', managerA.id],
    [collaboratorB.id, enterpriseB, brokerB, conversationB, contactB, appointmentB, 'MANAGER', managerB.id],
  ] as const) {
    await pool!.query(`INSERT INTO app_user_enterprises(user_id,enterprise_id,assigned_by_user_id,assignment_source) VALUES ($1,$2,$3,$4)`, [userId, entId, assignedBy, source]);
    await pool!.query(`INSERT INTO app_user_brokers(user_id,broker_id,assigned_by_user_id,assignment_source) VALUES ($1,$2,$3,$4)`, [userId, brokerId, assignedBy, source]);
    await pool!.query(`INSERT INTO app_user_conversations(user_id,conversation_id,assigned_by_user_id,assignment_source) VALUES ($1,$2,$3,$4)`, [userId, convId, assignedBy, source]);
    await pool!.query(`INSERT INTO app_user_contacts(user_id,contact_id,assigned_by_user_id,assignment_source) VALUES ($1,$2,$3,$4)`, [userId, contactId, assignedBy, source]);
    await pool!.query(`INSERT INTO app_user_appointments(user_id,appointment_id,assigned_by_user_id,assignment_source) VALUES ($1,$2,$3,$4)`, [userId, appointmentId, assignedBy, source]);
  }
  const tokens = {
    admin: await createSession(admin.id), managerA: await createSession(managerA.id), managerB: await createSession(managerB.id),
    collaboratorA: await createSession(collaboratorA.id), collaboratorB: await createSession(collaboratorB.id),
  };
  return { admin, managerA, managerB, collaboratorA, collaboratorB, enterpriseA, enterpriseB, brokerA, brokerB, contactA, contactB, conversationA, conversationB, appointmentA, appointmentB, tokens };
}

async function ids(response: Response, key: string): Promise<number[]> {
  if (response.status !== 200) assert.fail(`HTTP ${response.status}: ${await response.text()}`);
  const body = await response.json() as Record<string, Array<{ id: number | string }>>;
  return body[key].map((item) => Number(item.id)).sort((a, b) => a - b);
}

integrationTest('real REST routes isolate two managers and collaborators across Inbox, contacts, Agenda, Dashboard and export', async () => {
  const f = await createFixture();
  assert.deepEqual(await ids(await request('/projects', f.tokens.managerA), 'projects'), [f.enterpriseA]);
  assert.deepEqual(await ids(await request('/corretores', f.tokens.managerA), 'corretores'), [f.brokerA]);
  assert.deepEqual(await ids(await request('/whatsapp/conversations', f.tokens.managerA), 'conversations'), [f.conversationA]);
  assert.deepEqual(await ids(await request('/contacts', f.tokens.managerA), 'contacts'), [f.contactA]);
  assert.deepEqual(await ids(await request('/appointments', f.tokens.managerA), 'appointments'), [f.appointmentA]);
  assert.equal((await request(`/whatsapp/conversations/${f.conversationB}`, f.tokens.managerA)).status, 404);
  assert.equal((await request(`/contacts/${f.contactB}`, f.tokens.managerA)).status, 404);
  assert.equal((await request(`/appointments/${f.appointmentB}`, f.tokens.managerA)).status, 404);

  const csv = await (await request('/dashboard/export.csv?period=7d', f.tokens.managerA)).text();
  assert.match(csv, /Lead A/);
  assert.doesNotMatch(csv, /Lead B/);
  const overview = await (await request('/dashboard/overview?period=7d', f.tokens.managerA)).json() as { kpis: { activeConversations: number } };
  assert.equal(overview.kpis.activeConversations, 1);

  const managedUsers = await (await request('/users', f.tokens.managerA)).json() as { users: Array<{ id: number }> };
  assert.deepEqual(managedUsers.users.map((user) => user.id), [f.collaboratorA.id]);
  assert.equal((await request(`/users/${f.collaboratorB.id}/scope`, f.tokens.managerA)).status, 403);
  const forbiddenAssignment = await request(`/users/${f.collaboratorA.id}/scope`, f.tokens.managerA, {
    method: 'PUT', body: JSON.stringify({ managerId: f.managerA.id, enterpriseIds: [f.enterpriseB], brokerIds: [], conversationIds: [], contactIds: [], appointmentIds: [] }),
  });
  assert.equal(forbiddenAssignment.status, 403);

  assert.deepEqual(await ids(await request('/whatsapp/conversations', f.tokens.collaboratorA), 'conversations'), [f.conversationA]);
  assert.equal((await request(`/whatsapp/conversations/${f.conversationB}`, f.tokens.collaboratorA)).status, 404);
  for (const table of ['app_user_enterprises', 'app_user_brokers', 'app_user_conversations', 'app_user_contacts', 'app_user_appointments']) {
    await pool!.query(`DELETE FROM ${table} WHERE user_id=$1`, [f.collaboratorA.id]);
  }
  assert.deepEqual(await ids(await request('/whatsapp/conversations', f.tokens.collaboratorA), 'conversations'), []);
  const emptyOverview = await (await request('/dashboard/overview?period=7d', f.tokens.collaboratorA)).json() as { kpis: { activeConversations: number } };
  assert.equal(emptyOverview.kpis.activeConversations, 0);

  assert.deepEqual(await ids(await request('/whatsapp/conversations', f.tokens.admin), 'conversations'), [f.conversationA, f.conversationB]);
  assert.deepEqual(await ids(await request('/appointments', f.tokens.admin), 'appointments'), [f.appointmentA, f.appointmentB]);
});

integrationTest('scope reduction through real route commits assignment cleanup and session revocation together', async () => {
  const f = await createFixture();
  const response = await request(`/users/${f.managerA.id}/scope`, f.tokens.admin, {
    method: 'PUT', body: JSON.stringify({ managerId: null, enterpriseIds: [], brokerIds: [], conversationIds: [], contactIds: [], appointmentIds: [] }),
  });
  assert.equal(response.status, 200, await response.text());
  assert.equal(await getSessionUser(f.tokens.managerA), null);
  assert.equal(await getSessionUser(f.tokens.collaboratorA), null);
  const delegated = await pool!.query(`SELECT COUNT(*)::int AS count FROM app_user_conversations WHERE user_id=$1 AND assignment_source='MANAGER'`, [f.collaboratorA.id]);
  assert.equal(delegated.rows[0].count, 0);
});

integrationTest('administrative user creation, role cleanup and scope reduction roll back together on database failure', async () => {
  const f = await createFixture();
  await pool!.query(`
    CREATE TABLE test_failure_control(action text);
    CREATE OR REPLACE FUNCTION fail_selected_access_audit() RETURNS trigger AS $$
    BEGIN
      IF EXISTS (SELECT 1 FROM test_failure_control WHERE action = NEW.action) THEN
        RAISE EXCEPTION 'injected audit failure';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
    CREATE TRIGGER test_fail_access_audit BEFORE INSERT ON app_access_audit
      FOR EACH ROW EXECUTE FUNCTION fail_selected_access_audit();
  `);
  try {
    await pool!.query(`INSERT INTO test_failure_control VALUES ('USER_CREATED')`);
    const create = await request('/users', f.tokens.admin, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Rollback User', username: 'rollback.user', password: 'rollback-password-123', role: 'MANAGERIAL', active: true,
        managerId: null, enterpriseIds: [], brokerIds: [], conversationIds: [], contactIds: [], appointmentIds: [],
      }),
    });
    assert.equal(create.status, 500);
    assert.equal((await pool!.query(`SELECT COUNT(*)::int AS count FROM app_users WHERE username='rollback.user'`)).rows[0].count, 0);

    await pool!.query(`TRUNCATE test_failure_control; INSERT INTO test_failure_control VALUES ('USER_UPDATED')`);
    const patch = await request(`/users/${f.managerA.id}`, f.tokens.admin, { method: 'PATCH', body: JSON.stringify({ role: 'COLLABORATOR' }) });
    assert.equal(patch.status, 500);
    assert.equal((await pool!.query(`SELECT role FROM app_users WHERE id=$1`, [f.managerA.id])).rows[0].role, 'MANAGERIAL');
    assert.ok(await getSessionUser(f.tokens.managerA));
    assert.equal((await pool!.query(`SELECT COUNT(*)::int AS count FROM app_user_management WHERE manager_user_id=$1`, [f.managerA.id])).rows[0].count, 1);

    await pool!.query(`TRUNCATE test_failure_control; INSERT INTO test_failure_control VALUES ('USER_SCOPE_REPLACED')`);
    const scope = await request(`/users/${f.managerA.id}/scope`, f.tokens.admin, {
      method: 'PUT', body: JSON.stringify({ managerId: null, enterpriseIds: [], brokerIds: [], conversationIds: [], contactIds: [], appointmentIds: [] }),
    });
    assert.equal(scope.status, 500);
    assert.equal((await pool!.query(`SELECT COUNT(*)::int AS count FROM app_user_enterprises WHERE user_id=$1`, [f.managerA.id])).rows[0].count, 1);
    assert.ok(await getSessionUser(f.tokens.managerA));
    assert.ok(await getSessionUser(f.tokens.collaboratorA));
  } finally {
    await pool!.query(`DROP TRIGGER IF EXISTS test_fail_access_audit ON app_access_audit; DROP FUNCTION IF EXISTS fail_selected_access_audit(); DROP TABLE IF EXISTS test_failure_control`);
  }
});

function connectSocket(token: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createSocketClient(baseUrl, { auth: { token }, transports: ['websocket'], timeout: 3000 });
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

integrationTest('real Socket.IO delivery filters resource events and sends unidentified events only to ADMIN', async () => {
  const f = await createFixture();
  const sockets = await Promise.all([connectSocket(f.tokens.admin), connectSocket(f.tokens.managerA), connectSocket(f.tokens.managerB), connectSocket(f.tokens.collaboratorB)]);
  try {
    const scoped = sockets.map(() => 0);
    sockets.forEach((socket, index) => socket.on('integration.scoped', () => scoped[index]++));
    await publishAccessControlledRealtimeEvent('integration.scoped', { conversationId: f.conversationA }, f.conversationA);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.deepEqual(scoped, [1, 1, 0, 0]);

    const global = sockets.map(() => 0);
    sockets.forEach((socket, index) => socket.on('integration.global', () => global[index]++));
    await publishAccessControlledRealtimeEvent('integration.global', { kind: 'global' });
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.deepEqual(global, [1, 0, 0, 0]);
  } finally {
    sockets.forEach((socket) => socket.disconnect());
  }
});

class FakeSseResponse extends EventEmitter {
  writableEnded = false;
  writes: string[] = [];
  status() { return this; }
  setHeader() { return this; }
  flushHeaders() {}
  write(value: string) { this.writes.push(value); return true; }
  end() { if (this.writableEnded) return; this.writableEnded = true; this.emit('finish'); this.emit('close'); }
}

integrationTest('SSE registers, filters and disconnects immediately by session and user', async () => {
  const f = await createFixture();
  const responseA = new FakeSseResponse();
  const responseB = new FakeSseResponse();
  registerWhatsAppEventsSse({ authToken: f.tokens.managerA, user: f.managerA } as never, responseA as never);
  registerWhatsAppEventsSse({ authToken: f.tokens.managerB, user: f.managerB } as never, responseB as never);
  responseA.writes = [];
  responseB.writes = [];
  emitWhatsAppEvent('conversation.updated', { id: f.conversationA });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.ok(responseA.writes.some((line) => line.includes('conversation.updated')));
  assert.equal(responseB.writes.some((line) => line.includes('conversation.updated')), false);
  const logout = await request('/auth/logout', f.tokens.managerA, { method: 'POST' });
  assert.equal(logout.status, 200);
  assert.equal(responseA.writableEnded, true);
  const revoke = await request(`/users/${f.managerB.id}/sessions`, f.tokens.admin, { method: 'DELETE' });
  assert.equal(revoke.status, 200);
  assert.equal(responseB.writableEnded, true);
  assert.equal(getSseConnectionCountForTests(), 0);
});
