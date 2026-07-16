import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { INITIAL_ACCESS_USERS } from '../constants/initialAccessUsers.js';
import { hashPasswordForStorage, verifyPassword } from '../repositories/userRepository.js';
import { runInitialAccessSeed } from '../scripts/seed-initial-access-users.js';
import { createIntegrationPool, resetAuthIntegrationData } from './helpers/authIntegrationDb.js';

const pool = createIntegrationPool();
const integrationTest = pool ? test : test.skip;
const secret = 'seed-test-secret-value';

if (pool) {
  beforeEach(() => resetAuthIntegrationData(pool));
  after(() => pool.end());
}

function captureLogs() {
  const lines: string[] = [];
  return {
    lines,
    logger: {
      log(message?: unknown, metadata?: unknown) { lines.push(`${String(message)} ${JSON.stringify(metadata ?? {})}`); },
      error(message?: unknown, metadata?: unknown) { lines.push(`${String(message)} ${JSON.stringify(metadata ?? {})}`); },
    },
  };
}

integrationTest('seed creates seven users, roles, empty scopes and three management links atomically', async () => {
  const client = await pool!.connect();
  try {
    const logs = captureLogs();
    const result = await runInitialAccessSeed(client, { password: secret, logger: logs.logger });
    assert.deepEqual(result.createdUsernames, INITIAL_ACCESS_USERS.map((item) => item.username));
    const users = await pool!.query(`SELECT username, role, active, must_change_password FROM app_users ORDER BY id`);
    assert.equal(users.rowCount, 7);
    assert.deepEqual(users.rows.map((row) => [row.username, row.role]), INITIAL_ACCESS_USERS.map((item) => [item.username, item.role]));
    assert.ok(users.rows.every((row) => row.active && row.must_change_password));
    const links = await pool!.query(`
      SELECT c.username AS collaborator, m.username AS manager
        FROM app_user_management rel
        JOIN app_users c ON c.id = rel.collaborator_user_id
        JOIN app_users m ON m.id = rel.manager_user_id
       ORDER BY c.username
    `);
    assert.deepEqual(links.rows, [
      { collaborator: 'georgia.sdr', manager: 'lucas.pimenta' },
      { collaborator: 'kaua.sdr', manager: 'lucas.pimenta' },
      { collaborator: 'rafael.sdr', manager: 'lucas.pimenta' },
    ]);
    for (const table of ['app_user_enterprises', 'app_user_brokers', 'app_user_conversations', 'app_user_contacts', 'app_user_appointments']) {
      const count = await pool!.query(`SELECT COUNT(*)::int AS count FROM ${table}`);
      assert.equal(count.rows[0].count, 0);
    }
    assert.equal(logs.lines.some((line) => line.includes(secret)), false);
  } finally {
    client.release();
  }
});

integrationTest('second run preserves password, must-change flag, inactive status, role and divergent manager', async () => {
  const first = await pool!.connect();
  await runInitialAccessSeed(first, { password: secret, logger: captureLogs().logger });
  first.release();

  const changedHash = await hashPasswordForStorage('changed-password-123');
  await pool!.query(`UPDATE app_users SET password_hash=$1, must_change_password=false, active=false, role='COLLABORATOR' WHERE username='ulysses'`, [changedHash]);
  const alternate = await pool!.query<{ id: number }>(`
    INSERT INTO app_users (username,name,email,password_hash,role,active,must_change_password)
    VALUES ('alternate.manager','Alternate',NULL,$1,'MANAGERIAL',true,false) RETURNING id`, [changedHash]);
  const georgia = await pool!.query<{ id: number }>(`SELECT id FROM app_users WHERE username='georgia.sdr'`);
  await pool!.query(`UPDATE app_user_management SET manager_user_id=$1 WHERE collaborator_user_id=$2`, [alternate.rows[0].id, georgia.rows[0].id]);

  const client = await pool!.connect();
  try {
    const result = await runInitialAccessSeed(client, { password: 'another-initial-secret', logger: captureLogs().logger });
    assert.equal(result.createdUsernames.length, 0);
  } finally {
    client.release();
  }
  const preserved = await pool!.query(`SELECT password_hash, must_change_password, active, role FROM app_users WHERE username='ulysses'`);
  assert.equal(await verifyPassword(preserved.rows[0].password_hash, 'changed-password-123'), true);
  assert.deepEqual(
    { mustChange: preserved.rows[0].must_change_password, active: preserved.rows[0].active, role: preserved.rows[0].role },
    { mustChange: false, active: false, role: 'COLLABORATOR' }
  );
  const manager = await pool!.query(`SELECT manager_user_id FROM app_user_management WHERE collaborator_user_id=$1`, [georgia.rows[0].id]);
  assert.equal(manager.rows[0].manager_user_id, alternate.rows[0].id);
});

integrationTest('failure on sixth user rolls back the first five', async () => {
  const client = await pool!.connect();
  try {
    await assert.rejects(
      runInitialAccessSeed(client, {
        password: secret,
        logger: captureLogs().logger,
        beforeUser: (_username, index) => { if (index === 5) throw new Error('injected user failure'); },
      }),
      /injected user failure/
    );
  } finally {
    client.release();
  }
  const count = await pool!.query(`SELECT COUNT(*)::int AS count FROM app_users`);
  assert.equal(count.rows[0].count, 0);
});

integrationTest('failure while creating management links rolls back all users', async () => {
  const client = await pool!.connect();
  try {
    await assert.rejects(
      runInitialAccessSeed(client, {
        password: secret,
        logger: captureLogs().logger,
        beforeManagement: (_username, index) => { if (index === 1) throw new Error('injected management failure'); },
      }),
      /injected management failure/
    );
  } finally {
    client.release();
  }
  const [users, links] = await Promise.all([
    pool!.query(`SELECT COUNT(*)::int AS count FROM app_users`),
    pool!.query(`SELECT COUNT(*)::int AS count FROM app_user_management`),
  ]);
  assert.equal(users.rows[0].count, 0);
  assert.equal(links.rows[0].count, 0);
});
