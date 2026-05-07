import assert from 'node:assert/strict';
import test from 'node:test';
import { deleteConversationInTransaction } from '../repositories/conversationRepository.js';
import { resolveEnterpriseFromMessageAliases } from '../repositories/enterpriseMatch.js';
import type { EnterpriseRow } from '../repositories/enterpriseRepository.js';

type QueryRecord = { text: string; values?: unknown[] };

class FakeDeleteClient {
  readonly queries: QueryRecord[] = [];

  async query<T = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }> {
    this.queries.push({ text, values });
    const normalized = text.replace(/\s+/g, ' ').trim();

    if (normalized.startsWith('SELECT id, contact_id, enterprise_id')) {
      return {
        rows: [
          {
            id: 10,
            contact_id: 20,
            enterprise_id: 3,
            enterprise_origin_id: 3,
            lead_source_raw: { source: 'previous_campaign' },
          },
        ] as T[],
        rowCount: 1,
      };
    }

    if (normalized.startsWith('SELECT id, enterprise_id, enterprise_interest FROM contacts')) {
      return {
        rows: [{ id: 20, enterprise_id: 3, enterprise_interest: 'ALTIS PIRITUBA' }] as T[],
        rowCount: 1,
      };
    }

    if (normalized.startsWith('DELETE FROM messages')) return { rows: [], rowCount: 2 };
    if (normalized.startsWith('DELETE FROM ana_turn_audit')) return { rows: [], rowCount: 1 };
    if (normalized.startsWith('DELETE FROM conversations')) return { rows: [], rowCount: 1 };
    if (normalized.startsWith('UPDATE contacts')) return { rows: [], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  }
}

function enterprise(id: number, name: string, slug: string): EnterpriseRow {
  return {
    id,
    name,
    slug,
    status: 'ativo',
    language_style: 'natural',
    prompt_addons: '[]',
    tipo: 'APARTAMENTO',
    exclusivo: false,
    city: null,
    state_uf: null,
    commercial_region: null,
    ibge_code: null,
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    updated_at: new Date('2026-01-01T00:00:00.000Z'),
  };
}

test('excluir conversa limpa mensagens, auditoria e vinculo comercial do contato', async () => {
  const client = new FakeDeleteClient();

  const audit = await deleteConversationInTransaction(client, 10);

  assert.equal(audit?.conversationId, 10);
  assert.equal(audit?.contactId, 20);
  assert.equal(audit?.previousConversationEnterpriseId, 3);
  assert.equal(audit?.previousContactEnterpriseId, 3);
  assert.equal(audit?.previousContactEnterpriseInterest, 'ALTIS PIRITUBA');
  assert.equal(audit?.contactUnlinked, true);
  assert.equal(audit?.strategy, 'delete');
  assert.equal(audit?.deletedRows.messages, 2);
  assert.equal(audit?.deletedRows.ana_turn_audit, 1);

  const contactCleanup = client.queries.find((q) => q.text.includes('UPDATE contacts'));
  assert.ok(contactCleanup, 'contacts precisa ser atualizado na exclusao');
  assert.match(contactCleanup.text, /enterprise_id = NULL/);
  assert.match(contactCleanup.text, /enterprise_interest = NULL/);
  assert.deepEqual(contactCleanup.values, [20]);
});

test('apos limpeza, inbound "ola" fica unresolved e "Quero saber do Altis" resolve pela mensagem atual', () => {
  const enterprises = [
    enterprise(3, 'Altis Pirituba', 'altis-pirituba'),
    enterprise(4, 'Residencial Evora', 'residencial-evora'),
  ];

  const greeting = resolveEnterpriseFromMessageAliases('ola', enterprises);
  assert.equal(greeting.source, 'unresolved');
  assert.equal(greeting.enterpriseId, null);
  assert.equal(greeting.candidates.length, 0);

  const explicitAltis = resolveEnterpriseFromMessageAliases('Quero saber do Altis', enterprises);
  assert.equal(explicitAltis.source, 'message_alias');
  assert.equal(explicitAltis.enterpriseId, 3);
  assert.equal(explicitAltis.enterpriseName, 'Altis Pirituba');
});
