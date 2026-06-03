import assert from 'node:assert/strict';
import test from 'node:test';
import { extractCustomerNameFromUserUtterance } from '../utils/extractCustomerNameFromMessage.js';

test('hotfix: captura "ulysses" apos pergunta real "me conta seu nome"', () => {
  const name = extractCustomerNameFromUserUtterance('ulysses', {
    lastAssistantPlain: 'Antes de te passar as melhores informa��es, me conta seu nome?',
  });

  assert.equal(name, 'Ulysses');
});

test('hotfix: captura "ana clara" apos pergunta real "me conta seu nome"', () => {
  const name = extractCustomerNameFromUserUtterance('ana clara', {
    lastAssistantPlain: 'Antes de te passar as melhores informa��es, me conta seu nome?',
  });

  assert.equal(name, 'Ana Clara');
});

test('hotfix: nao captura topicos comerciais como nome apos pergunta de nome', () => {
  const ctx = {
    lastAssistantPlain: 'Antes de te passar as melhores informa��es, me conta seu nome?',
  };

  assert.equal(extractCustomerNameFromUserUtterance('lazer', ctx), null);
  assert.equal(extractCustomerNameFromUserUtterance('valor', ctx), null);
  assert.equal(extractCustomerNameFromUserUtterance('regiao', ctx), null);
  assert.equal(extractCustomerNameFromUserUtterance('morar', ctx), null);
  assert.equal(extractCustomerNameFromUserUtterance('investir', ctx), null);
});
