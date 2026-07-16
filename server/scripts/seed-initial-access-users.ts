import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import type pg from 'pg';
import { getPool } from '../db/pg.js';
import { INITIAL_ACCESS_USERS } from '../constants/initialAccessUsers.js';
import { hashPasswordForStorage } from '../repositories/userRepository.js';

type SeedLogger = Pick<Console, 'log' | 'error'>;

export interface InitialAccessSeedOptions {
  password: string;
  logger?: SeedLogger;
  /** Test-only failure injection; production callers must leave this unset. */
  beforeUser?: (username: string, index: number) => void | Promise<void>;
  beforeManagement?: (username: string, index: number) => void | Promise<void>;
}

export interface InitialAccessSeedResult {
  createdUsernames: string[];
  preservedUsernames: string[];
  createdManagementUsernames: string[];
  preservedManagementUsernames: string[];
}

type ExistingUser = {
  id: number;
  role: string;
  active: boolean;
  must_change_password: boolean;
};

/**
 * Conservador por padrão: uma conta já existente nunca é modificada. Toda a
 * execução usa o mesmo client e a mesma transação, incluindo vínculos.
 */
export async function runInitialAccessSeed(
  client: pg.PoolClient,
  options: InitialAccessSeedOptions
): Promise<InitialAccessSeedResult> {
  if (!options.password) throw new Error('Defina INITIAL_ACCESS_PASSWORD.');
  const logger = options.logger ?? console;
  const ids = new Map<string, number>();
  const created = new Set<string>();
  const result: InitialAccessSeedResult = {
    createdUsernames: [],
    preservedUsernames: [],
    createdManagementUsernames: [],
    preservedManagementUsernames: [],
  };

  await client.query('BEGIN');
  try {
    for (const [index, definition] of INITIAL_ACCESS_USERS.entries()) {
      await options.beforeUser?.(definition.username, index);
      const existingResult = await client.query<ExistingUser>(
        `SELECT id, role, active, must_change_password
           FROM app_users
          WHERE LOWER(username) = $1
          LIMIT 1
          FOR UPDATE`,
        [definition.username]
      );
      const existing = existingResult.rows[0];
      if (existing) {
        ids.set(definition.username, existing.id);
        result.preservedUsernames.push(definition.username);
        logger.log('[seed-initial-access] existing_preserved', {
          username: definition.username,
          id: existing.id,
          active: existing.active,
          currentRole: existing.role,
          expectedRole: definition.role,
          roleMatches: existing.role === definition.role,
          mustChangePasswordPreserved: existing.must_change_password,
        });
        continue;
      }

      const passwordHash = await hashPasswordForStorage(options.password);
      const inserted = await client.query<{ id: number }>(
        `INSERT INTO app_users
           (username, name, email, password_hash, role, active, must_change_password, broker_id, django_user_id)
         VALUES ($1, $2, NULL, $3, $4, true, true, NULL, NULL)
         RETURNING id`,
        [definition.username, definition.name, passwordHash, definition.role]
      );
      const id = inserted.rows[0]?.id;
      if (!id) throw new Error(`Falha ao criar ${definition.username}.`);
      ids.set(definition.username, id);
      created.add(definition.username);
      result.createdUsernames.push(definition.username);
      logger.log('[seed-initial-access] created', { username: definition.username, id });
    }

    let managementIndex = 0;
    for (const definition of INITIAL_ACCESS_USERS) {
      if (!definition.managerUsername) continue;
      await options.beforeManagement?.(definition.username, managementIndex++);
      const collaboratorId = ids.get(definition.username);
      const managerId = ids.get(definition.managerUsername);
      if (!collaboratorId || !managerId) throw new Error(`Vínculo incompleto para ${definition.username}.`);

      const current = await client.query<{ manager_user_id: number }>(
        `SELECT manager_user_id
           FROM app_user_management
          WHERE collaborator_user_id = $1
          LIMIT 1
          FOR UPDATE`,
        [collaboratorId]
      );
      if (current.rows[0]) {
        result.preservedManagementUsernames.push(definition.username);
        logger.log('[seed-initial-access] management_preserved', {
          collaborator: definition.username,
          currentManagerId: current.rows[0].manager_user_id,
          expectedManagerId: managerId,
          managerMatches: current.rows[0].manager_user_id === managerId,
        });
        continue;
      }

      if (!created.has(definition.username)) {
        result.preservedManagementUsernames.push(definition.username);
        logger.log('[seed-initial-access] management_missing_preserved', {
          collaborator: definition.username,
          expectedManager: definition.managerUsername,
          reason: 'existing_account_is_conservative',
        });
        continue;
      }

      await client.query(
        `INSERT INTO app_user_management (collaborator_user_id, manager_user_id, created_by_user_id)
         VALUES ($1, $2, NULL)`,
        [collaboratorId, managerId]
      );
      result.createdManagementUsernames.push(definition.username);
      logger.log('[seed-initial-access] management_created', {
        collaborator: definition.username,
        manager: definition.managerUsername,
      });
    }

    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function main(): Promise<void> {
  const password = process.env.INITIAL_ACCESS_PASSWORD ?? '';
  if (!password) throw new Error('Defina INITIAL_ACCESS_PASSWORD.');
  const client = await getPool().connect();
  try {
    await runInitialAccessSeed(client, { password });
  } finally {
    client.release();
    await getPool().end();
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    console.error('[seed-initial-access] failed', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
