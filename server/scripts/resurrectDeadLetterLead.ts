// server/scripts/resurrectDeadLetterLead.ts
//
// Uso manual, depois que o mapeamento (NetivEnterprise.company) foi
// corrigido no Django Admin. Reseta o contador de tentativas e remove
// o lead do dead-letter, fazendo ele voltar a ser tentado no próximo
// tick do djangoSyncWorker (até 10s depois).
//
// Rodar com:
//   npx tsx server/scripts/resurrectDeadLetterLead.ts --enterprise-id=123
//   npx tsx server/scripts/resurrectDeadLetterLead.ts --conversation-id=456
//   npx tsx server/scripts/resurrectDeadLetterLead.ts --all

import { query } from '../db/pg.js';

declare const process: {
  argv: string[];
  exit(code?: number): never;
};

async function main() {
  const args: string[] = process.argv.slice(2);
  const enterpriseArg = args.find((a: string) => a.startsWith('--enterprise-id='));
  const conversationArg = args.find((a: string) => a.startsWith('--conversation-id='));
  const all = args.includes('--all');

  if (!enterpriseArg && !conversationArg && !all) {
    console.error('Uso: --enterprise-id=<id> | --conversation-id=<id> | --all');
    process.exit(1);
  }

  let result: { rows: Array<{ id: number }> };
  if (all) {
    result = await query<{ id: number }>(
      `UPDATE conversations
          SET django_sync_attempts = 0, django_sync_dead_letter = FALSE, django_sync_last_error = NULL
        WHERE django_sync_dead_letter = TRUE
        RETURNING id`
    );
  } else if (enterpriseArg) {
    const enterpriseId = Number(enterpriseArg.split('=')[1]);
    result = await query<{ id: number }>(
      `UPDATE conversations
          SET django_sync_attempts = 0, django_sync_dead_letter = FALSE, django_sync_last_error = NULL
        WHERE django_sync_dead_letter = TRUE AND enterprise_id = $1
        RETURNING id`,
      [enterpriseId]
    );
  } else {
    const conversationId = Number(conversationArg!.split('=')[1]);
    result = await query<{ id: number }>(
      `UPDATE conversations
          SET django_sync_attempts = 0, django_sync_dead_letter = FALSE, django_sync_last_error = NULL
        WHERE id = $1
        RETURNING id`,
      [conversationId]
    );
  }

  console.log(`Resetados ${result.rows.length} lead(s):`, result.rows.map((r) => r.id));
  process.exit(0);
}

main().catch((err) => {
  console.error('Erro:', err);
  process.exit(1);
});
