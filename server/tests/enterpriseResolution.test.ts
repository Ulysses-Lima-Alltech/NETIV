import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveEnterpriseFromMessageAliases,
  type EnterpriseResolutionCandidate,
} from '../repositories/enterpriseMatch.js';
import type { EnterpriseRow } from '../repositories/enterpriseRepository.js';

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

const enterprises = [
  enterprise(1, 'Altis Pirituba', 'altis-pirituba'),
  enterprise(2, 'Residencial Évora', 'residencial-evora'),
  enterprise(3, 'Vista Sol', 'vista-sol'),
];

function candidateIds(candidates: EnterpriseResolutionCandidate[]): number[] {
  return candidates.map((candidate) => candidate.enterpriseId).sort((a, b) => a - b);
}

test('mensagem sem alias de empreendimento fica unresolved', () => {
  const result = resolveEnterpriseFromMessageAliases('Oi', enterprises);

  assert.equal(result.source, 'unresolved');
  assert.equal(result.enterpriseId, null);
  assert.deepEqual(result.candidates, []);
});

test('resolve Altis pela mensagem atual usando alias distintivo', () => {
  const result = resolveEnterpriseFromMessageAliases('Quero saber do Altis', enterprises);

  assert.equal(result.source, 'message_alias');
  assert.equal(result.enterpriseId, 1);
  assert.equal(result.enterpriseName, 'Altis Pirituba');
});

test('resolve Évora ignorando acento e caixa', () => {
  const result = resolveEnterpriseFromMessageAliases('quero saber do EVORA', enterprises);

  assert.equal(result.source, 'message_alias');
  assert.equal(result.enterpriseId, 2);
  assert.equal(result.enterpriseName, 'Residencial Évora');
});

test('termos comerciais sem alias nao escolhem empreendimento', () => {
  const result = resolveEnterpriseFromMessageAliases('Quero saber os valores', enterprises);

  assert.equal(result.source, 'unresolved');
  assert.equal(result.enterpriseId, null);
});

test('alias compartilhado entre empreendimentos exige esclarecimento', () => {
  const result = resolveEnterpriseFromMessageAliases('Quero saber do Pedra do Sol', enterprises, [
    { enterprise_id: 2, alias: 'Pedra do Sol', normalized_alias: 'pedra do sol' },
    { enterprise_id: 3, alias: 'Pedra do Sol', normalized_alias: 'pedra do sol' },
  ]);

  assert.equal(result.source, 'ambiguous');
  assert.equal(result.enterpriseId, null);
  assert.deepEqual(candidateIds(result.candidates), [2, 3]);
});
