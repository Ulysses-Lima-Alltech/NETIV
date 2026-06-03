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

const forbiddenMissingDetailFallbackFragments = [
  'Não tenho esse detalhe confirmado por aqui',
  'O corretor consegue te passar certinho',
  'Quer que eu te encaminhe ou prefere agendar uma visita?',
] as const;

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
    /!effectiveCommercialRule &&\s*!isKnowledgeGapTurn &&\s*leadQualificationSignalsChangedThisTurn/
  );
  assert.doesNotMatch(
    engineSource,
    /!effectiveCommercialRule &&\s*!ANA_LLM_FIRST_COMMERCIAL_REPLIES[\s\S]{0,120}leadQualificationSignalsChangedThisTurn/
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

test('LLM-first failure fallbacks use contextual non-forbidden copy', () => {
  assert.match(
    engineSource,
    /Tive uma instabilidade para consultar as informações agora\. Posso continuar te ajudando por aqui ou, se preferir, te encaminhar para um corretor\?/
  );
  assert.match(
    engineSource,
    /Essa parte depende de confirmação atualizada\. Posso te ajudar a seguir com um corretor ou marcar uma visita\?/
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

test('forbidden missing-detail fallback text is absent from critical production files', () => {
  for (const [fileName, source] of criticalSources) {
    for (const forbidden of forbiddenMissingDetailFallbackFragments) {
      assert.equal(source.toLowerCase().includes(forbidden.toLowerCase()), false, fileName);
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

test('conversation state bypasses missing-RAG fallback in LLM-first mode', () => {
  assert.match(engineSource, /\[ANA_NAME_VARIABLE_CAPTURE_ATTEMPT\]/);
  assert.match(engineSource, /\[ANA_NAME_VARIABLE_CAPTURED\]/);
  assert.match(engineSource, /\[ANA_NAME_VARIABLE_NORMALIZED\]/);
  assert.match(engineSource, /\[ANA_NAME_CAPTURE_BYPASSED_LLM_FIRST\]/);
  assert.match(engineSource, /\[ANA_NAME_CAPTURED_LLM_FIRST_BYPASS\]/);
  assert.match(engineSource, /\[ANA_INITIAL_QUALIFICATION_CONTINUED_AFTER_NAME\]/);
  assert.match(engineSource, /\[ANA_CLARIFICATION_REPAIR_HANDLED\]/);
  assert.match(engineSource, /\[ANA_MISSING_RAG_FALLBACK_BLOCKED_AFTER_NAME_QUESTION\]/);
  assert.match(engineSource, /\[ANA_MISSING_RAG_FALLBACK_BLOCKED_FOR_CONVERSATION_STATE\]/);
  assert.match(engineSource, /\[ANA_FORBIDDEN_MISSING_DETAIL_FALLBACK_BLOCKED\]/);
  assert.match(engineSource, /lastAssistantAskedCustomerNameThisTurn/);
  assert.match(engineSource, /ANA_NAME_QUESTION_REPAIR_REPLY/);
  assert.match(engineSource, /isInitialQualificationClarificationMessage\(trimmed\)/);
  assert.match(engineSource, /buildInitialQualificationClarificationReply/);
});

test('non-name reply after name question is repaired before commercial LLM path', () => {
  const repairStart = engineSource.indexOf('lastAssistantAskedCustomerNameThisTurn');
  const commercialStart = engineSource.indexOf('const evoraKnowledgeDrivenMode', repairStart);
  const repairBlock = engineSource.slice(repairStart, commercialStart);

  assert.ok(repairStart >= 0, 'name-question repair boundary should exist');
  assert.ok(commercialStart > repairStart, 'name-question repair should run before commercial mode branch');
  assert.match(repairBlock, /!trustedCustomerName/);
  assert.match(repairBlock, /!objectiveCustomerQuestionThisTurn/);
  assert.match(repairBlock, /!isInitialQualificationClarificationMessage\(trimmed\)/);
  assert.match(repairBlock, /ANA_NAME_QUESTION_REPAIR_REPLY/);
  for (const forbidden of forbiddenMissingDetailFallbackFragments) {
    assert.equal(repairBlock.toLowerCase().includes(forbidden.toLowerCase()), false);
  }
});

test('clarification repair explains initial qualification instead of missing-data fallback', () => {
  assert.match(engineSource, /function buildInitialQualificationClarificationReply/);
  assert.match(engineSource, /Sem problema, eu explico melhor/);
  assert.match(engineSource, /perguntas simples/);
  assert.match(engineSource, /morar, investir ou só conhecendo/);
  const clarificationStart = engineSource.indexOf('function buildInitialQualificationClarificationReply');
  const clarificationEnd = engineSource.indexOf('function axisHumanLabel', clarificationStart);
  const clarificationBlock = engineSource.slice(clarificationStart, clarificationEnd);
  assert.doesNotMatch(clarificationBlock, /Não tenho esse detalhe confirmado/);
  assert.doesNotMatch(clarificationBlock, /corretor consegue te passar certinho/);
});
