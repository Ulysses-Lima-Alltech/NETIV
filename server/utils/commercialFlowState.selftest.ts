/**
 * Validação manual: `npx tsx utils/commercialFlowState.selftest.ts`
 */
import assert from 'assert';
import {
  isShortCommercialContinuation,
  tryRecoverEnterpriseIdFromFlowState,
} from './commercialFlowState.js';
import type { EnterpriseRow } from '../repositories/enterpriseRepository.js';

const mockEnt = (id: number, name: string, slug: string, tipo: EnterpriseRow['tipo']): EnterpriseRow =>
  ({
    id,
    name,
    slug,
    status: 'ativo',
    language_style: 'natural',
    prompt_addons: '[]',
    tipo,
    exclusivo: false,
    created_at: new Date(),
    updated_at: new Date(),
  }) as EnterpriseRow;

const pool = [mockEnt(1, 'Residencial Évora', 'evora', 'LOTEAMENTO'), mockEnt(2, 'Montaresa', 'montaresa', 'LOTEAMENTO')];

assert.strictEqual(isShortCommercialContinuation('lazer', false), true);
assert.strictEqual(isShortCommercialContinuation('me fale sobre o evora', true), false);
assert.strictEqual(isShortCommercialContinuation('quero um loteamento', false), false);

const r = tryRecoverEnterpriseIdFromFlowState({
  trimmedUser: 'lazer',
  enterpriseIdInDb: null,
  lastAssistantText:
    'No Évora temos área de lazer ampla. Me diz o que você quer priorizar que eu sigo com você.',
  flowState: { lastInferredEnterpriseId: null },
  explicitSwitch: false,
  matchPool: pool,
  allEnterprises: pool,
});
assert.strictEqual(r?.enterpriseId, 1, 'deve inferir Évora pelo texto da assistente');

console.log('commercialFlowState.selftest OK');
