/**
 * Entrypoint central da camada de banco de dados.
 *
 * Toda a persistência usa PostgreSQL via `pg`. Este módulo reexporta
 * as funções de `db/pg.ts` para que qualquer consumidor possa importar
 * de `../db/index.js` ou `../db/pg.js` indistintamente.
 *
 * As migrations SQLite (db/migrations/*.sql) são legado e podem ser
 * removidas quando conveniente. As migrations ativas ficam em
 * db/migrations/pg/ e são executadas por `initPostgres()` no boot.
 */
export { getPool, query, initPostgres } from './pg.js';
