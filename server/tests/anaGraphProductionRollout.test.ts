import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isAnaGraphProductionMasterEnabled,
  isAnaGraphProductionEnabledForEnterprise,
} from '../services/anaGraph/productionRollout.js';

function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) previous[key] = process.env[key];
  try {
    for (const [key, value] of Object.entries(vars)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('desligado por padrao sem nenhuma env var configurada', () => {
  withEnv({ ANA_GRAPH_PRODUCTION_ENABLED: undefined, ANA_GRAPH_PRODUCTION_ENTERPRISE_IDS: undefined }, () => {
    assert.equal(isAnaGraphProductionMasterEnabled(), false);
    assert.equal(isAnaGraphProductionEnabledForEnterprise(1), false);
  });
});

test('master switch ligado sem allowlist ainda bloqueia todas as empresas', () => {
  withEnv({ ANA_GRAPH_PRODUCTION_ENABLED: 'true', ANA_GRAPH_PRODUCTION_ENTERPRISE_IDS: undefined }, () => {
    assert.equal(isAnaGraphProductionMasterEnabled(), true);
    assert.equal(isAnaGraphProductionEnabledForEnterprise(1), false);
    assert.equal(isAnaGraphProductionEnabledForEnterprise(999), false);
  });
});

test('allowlist sem master switch tambem bloqueia', () => {
  withEnv({ ANA_GRAPH_PRODUCTION_ENABLED: undefined, ANA_GRAPH_PRODUCTION_ENTERPRISE_IDS: '1,3' }, () => {
    assert.equal(isAnaGraphProductionEnabledForEnterprise(1), false);
  });
});

test('master switch + allowlist habilita so os enterpriseIds listados', () => {
  withEnv({ ANA_GRAPH_PRODUCTION_ENABLED: 'true', ANA_GRAPH_PRODUCTION_ENTERPRISE_IDS: '1, 3,  7' }, () => {
    assert.equal(isAnaGraphProductionEnabledForEnterprise(1), true);
    assert.equal(isAnaGraphProductionEnabledForEnterprise(3), true);
    assert.equal(isAnaGraphProductionEnabledForEnterprise(7), true);
    assert.equal(isAnaGraphProductionEnabledForEnterprise(2), false);
    assert.equal(isAnaGraphProductionEnabledForEnterprise(null), false);
  });
});
