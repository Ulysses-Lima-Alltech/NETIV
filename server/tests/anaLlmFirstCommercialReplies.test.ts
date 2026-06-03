import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const engineSource = readFileSync(new URL('../services/conversationEngine.ts', import.meta.url), 'utf8');
const criticalSources = [
  ['conversationEngine.ts', engineSource],
  ['anaReplyFinalize.ts', readFileSync(new URL('../utils/anaReplyFinalize.ts', import.meta.url), 'utf8')],
  ['anaConversationPolicy.ts', readFileSync(new URL('../utils/anaConversationPolicy.ts', import.meta.url), 'utf8')],
  ['anaCommercialRulesService.ts', readFileSync(new URL('../services/anaCommercialRulesService.ts', import.meta.url), 'utf8')],
  ['anaCommercialRules.ts', readFileSync(new URL('../config/anaCommercialRules.ts', import.meta.url), 'utf8')],
  ['anaLeadQualificationPolicy.ts', readFileSync(new URL('../utils/anaLeadQualificationPolicy.ts', import.meta.url), 'utf8')],
] as const;

const forbiddenCommercialFallbackFragments = [
  /O Évora é um loteamento fechado/i,
  /O Evora e um loteamento fechado/i,
  /Tem lotes a partir de 360/i,
  /Para detalhes espec[ií]ficos que variam conforme disponibilidade/i,
  /quer que eu encaminhe para um corretor te passar certinho/i,
  /loteamento fechado em Atibaia/i,
];

test('LLM-first commercial replies flag is enabled by default and logs the new path', () => {
  assert.match(engineSource, /const ANA_LLM_FIRST_COMMERCIAL_REPLIES =[\s\S]*\?\? 'true'/);
  assert.match(engineSource, /\[ANA_LLM_FIRST_COMMERCIAL_ENABLED\]/);
  assert.match(engineSource, /\[ANA_COMMERCIAL_DETERMINISTIC_BYPASSED\]/);
  assert.match(engineSource, /\[ANA_QWEN_REQUIRED_FOR_COMMERCIAL_REPLY\]/);
  assert.match(engineSource, /\[ANA_COMMERCIAL_RAG_CONTEXT_REQUESTED\]/);
  assert.match(engineSource, /\[ANA_COMMERCIAL_FALLBACK_BLOCKED_BY_LLM_FIRST\]/);
  assert.match(engineSource, /\[ANA_LLM_FIRST_TECHNICAL_FALLBACK_USED\]/);
});

test('commercial deterministic rules are bypassed before final reply when LLM-first is enabled', () => {
  assert.match(
    engineSource,
    /effectiveCommercialRule &&\s*\(\!ANA_LLM_FIRST_COMMERCIAL_REPLIES \|\| commercialRuleAllowedAsOperationalDeterministic\)[\s\S]*willCallQwen: false/
  );
  assert.match(
    engineSource,
    /commercialRuleAllowedAsOperationalDeterministic =\s*effectiveCommercialRule\?\.ruleId === 'visita_agendamento'/
  );
  assert.match(
    engineSource,
    /!effectiveCommercialRule &&\s*!ANA_LLM_FIRST_COMMERCIAL_REPLIES[\s\S]*leadQualificationSignalsChangedThisTurn/
  );
});

test('commercial missing-RAG and no-LLM fallbacks are disabled by LLM-first commercial replies', () => {
  assert.match(
    engineSource,
    /const shouldBlockFreeformWithoutRag =\s*!ANA_LLM_FIRST_COMMERCIAL_REPLIES &&[\s\S]*ragMissingAndKnowledgeDependent/
  );
  assert.match(
    engineSource,
    /if \(\s*!ANA_LLM_FIRST_COMMERCIAL_REPLIES &&\s*anaBudgetConfig\.priceMissingNoLlm/
  );
});

test('Qwen prompt receives the LLM-first commercial instruction without increasing budgets', () => {
  assert.match(engineSource, /Responda perguntas comerciais com base no RAG\/evidencias autorizadas/);
  assert.match(engineSource, /Nao invente/);
  assert.match(engineSource, /Nao mencione NETIV, sistema, RAG, base, regra ou instrucao interna/);
  assert.doesNotMatch(engineSource, /ANA_RAG_MAX_CHUNKS\s*=\s*[4-9]/);
  assert.doesNotMatch(engineSource, /maxTokens:\s*(?:22[1-9]|2[3-9]\d|[3-9]\d\d)/);
});

test('fixed Evora overview fallback is absent from critical production files', () => {
  for (const [fileName, source] of criticalSources) {
    for (const forbidden of forbiddenCommercialFallbackFragments) {
      assert.doesNotMatch(source, forbidden, fileName);
    }
  }
});

test('production scenarios cannot use the fixed overview as fallback', () => {
  for (const userMessage of ['Oi, queria saber mais sobre o Évora', 'lazer', 'REGIAO', 'morar']) {
    assert.match(
      engineSource,
      /ANA_QWEN_REQUIRED_FOR_COMMERCIAL_REPLY/,
      `${userMessage} must stay on the Qwen-required path`
    );
    for (const forbidden of forbiddenCommercialFallbackFragments) {
      assert.doesNotMatch(engineSource, forbidden, `${userMessage} must not have fixed overview fallback`);
    }
  }
});
