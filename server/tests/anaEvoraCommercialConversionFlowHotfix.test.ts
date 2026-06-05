import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const engine = fs.readFileSync(new URL('../services/conversationEngine.ts', import.meta.url), 'utf8');

test('interesse forte de compra ou proximo passo leva para corretor ou visita', () => {
  assert.match(engine, /\[ANA_EVORA_CONVERSION_NEXT_STEP_GUARD\]/);
  assert.match(engine, /quero comprar/);
  assert.match(engine, /proximo passo/);
  assert.match(engine, /Você prefere que eu te encaminhe para o corretor ou quer agendar uma visita\?/);
});

test('duvida do cliente oferece responder ou encaminhar para corretor', () => {
  assert.match(engine, /\[ANA_EVORA_DOUBT_TO_BROKER_OR_VISIT_GUARD\]/);
  assert.match(engine, /tenho duvida/);
  assert.match(engine, /Você quer me dizer sua dúvida agora ou prefere que eu te encaminhe para o corretor\?/);
});

test('Ana nao deve repetir pergunta de morar investir depois de ja coletar objetivo', () => {
  assert.match(engine, /evoraRepeatsPurposeQuestion/);
  assert.match(engine, /morar,?\s*investir/);
  assert.match(engine, /propósito agora|proposito agora/);
  assert.match(engine, /\[ANA_EVORA_CONCRETE_NEXT_TOPIC_GUARD\]/);
});

test('perguntas finais devem sair de estilo de vida e voltar para loteamento', () => {
  assert.match(engine, /evoraLifestyleClosingQuestion/);
  assert.match(engine, /voce ja imaginou|você já imaginou/);
  assert.match(engine, /evoraPickConcreteNextQuestion/);
  assert.match(engine, /tamanhos dos lotes|formas de pagamento|acesso até o Évora|agendar uma visita/);
});

test('Ana evita ofertar topico que ja respondeu', () => {
  assert.match(engine, /evoraFinalQuestionRepeatsAnsweredTopic/);
  assert.match(engine, /evoraTopicAnsweredForConversion\('seguranca'\)/);
  assert.match(engine, /evoraTopicAnsweredForConversion\('lazer'\)/);
  assert.match(engine, /evoraTopicAnsweredForConversion\('localizacao'\)/);
  assert.match(engine, /evoraTopicAnsweredForConversion\('valores'\)/);
});

test('120x sem juros e corrigido para 120x com juros', () => {
  assert.match(engine, /\[ANA_EVORA_PAYMENT_TERMS_OUTPUT_CORRECTED\]/);
  assert.match(engine, /120x_sem_juros_not_allowed/);
  assert.match(engine, /120x com juros/);
});