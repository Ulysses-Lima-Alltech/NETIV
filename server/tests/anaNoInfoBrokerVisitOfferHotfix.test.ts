import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

test('conversationEngine oferece corretor ou visita quando nao tem resposta segura', () => {
  const source = fs.readFileSync(new URL('../services/conversationEngine.ts', import.meta.url), 'utf8');

  assert.match(source, /buildAnaNoInfoBrokerVisitOffer/);
  assert.match(source, /corretor/);
  assert.match(source, /agendar uma visita/);
  assert.match(source, /ANA_LLM_FIRST_MISSING_INFO_REPLY\s*=\s*\n\s*buildAnaNoInfoBrokerVisitOffer\(\)/);
});
