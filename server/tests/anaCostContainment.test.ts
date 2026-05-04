import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  ANA_OUTBOUND_QUOTA_EXCEEDED_REASON,
  evaluateAnaOutboundQuota,
} from '../services/anaOutboundQuotaService.js';
import { resolveAnaOpenAIModel } from '../utils/resolveAnaOpenAIModel.js';

test('cota permite Ana quando inbound_count=1 e ana_outbound_count=0', () => {
  const decision = evaluateAnaOutboundQuota({
    inboundCount: 1,
    anaOutboundCount: 0,
    isAutomaticAna: true,
  });

  assert.equal(decision.allowed, true);
  assert.equal(decision.reason, null);
});

test('cota bloqueia Ana quando inbound_count=1 e ana_outbound_count=1', () => {
  const decision = evaluateAnaOutboundQuota({
    inboundCount: 1,
    anaOutboundCount: 1,
    isAutomaticAna: true,
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, ANA_OUTBOUND_QUOTA_EXCEEDED_REASON);
});

test('cota permite Ana quando inbound_count=2 e ana_outbound_count=1', () => {
  const decision = evaluateAnaOutboundQuota({
    inboundCount: 2,
    anaOutboundCount: 1,
    isAutomaticAna: true,
  });

  assert.equal(decision.allowed, true);
  assert.equal(decision.reason, null);
});

test('cota bloqueia Ana quando inbound_count=2 e ana_outbound_count=2', () => {
  const decision = evaluateAnaOutboundQuota({
    inboundCount: 2,
    anaOutboundCount: 2,
    isAutomaticAna: true,
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, ANA_OUTBOUND_QUOTA_EXCEEDED_REASON);
});

test('cota nao bloqueia mensagem manual/humana', () => {
  const decision = evaluateAnaOutboundQuota({
    inboundCount: 1,
    anaOutboundCount: 10,
    isAutomaticAna: false,
  });

  assert.equal(decision.allowed, true);
  assert.equal(decision.reason, null);
});

test('conversa sem enterprise_id usa modelo barato default ou ANA_UNCLASSIFIED_ENTERPRISE_MODEL', () => {
  const previous = process.env.ANA_UNCLASSIFIED_ENTERPRISE_MODEL;
  delete process.env.ANA_UNCLASSIFIED_ENTERPRISE_MODEL;
  const defaultResolution = resolveAnaOpenAIModel({
    modelHotLeadFromDb: 'gpt-4.1',
    modelColdLeadFromDb: 'gpt-4.1',
    enterpriseResolved: false,
  });

  process.env.ANA_UNCLASSIFIED_ENTERPRISE_MODEL = 'gpt-cheap-test';
  const envResolution = resolveAnaOpenAIModel({
    modelHotLeadFromDb: 'gpt-4.1',
    modelColdLeadFromDb: 'gpt-4.1',
    enterpriseResolved: false,
  });

  if (previous === undefined) delete process.env.ANA_UNCLASSIFIED_ENTERPRISE_MODEL;
  else process.env.ANA_UNCLASSIFIED_ENTERPRISE_MODEL = previous;

  assert.equal(defaultResolution.finalModel, 'gpt-4.1-mini');
  assert.equal(defaultResolution.selectionReason, 'unclassified_enterprise_low_cost_model');
  assert.equal(envResolution.finalModel, 'gpt-cheap-test');
  assert.equal(envResolution.selectionReason, 'unclassified_enterprise_low_cost_model');
});

test('conversa com enterprise_id resolvido usa modelo normal atual', () => {
  const resolution = resolveAnaOpenAIModel({
    modelHotLeadFromDb: 'gpt-4.1',
    modelColdLeadFromDb: 'gpt-4.1-mini',
    enterpriseResolved: true,
  });

  assert.equal(resolution.finalModel, 'gpt-4.1');
  assert.equal(resolution.selectionReason, 'enterprise_resolved_standard_model');
});

test('openaiService nao envia service_tier priority', () => {
  const openaiServiceSource = readFileSync(new URL('../services/openaiService.js', import.meta.url), 'utf8');

  assert.doesNotMatch(openaiServiceSource, /service_tier/);
  assert.doesNotMatch(openaiServiceSource, /priority/);
});
