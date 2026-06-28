import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractAnaImageFilenameTopic,
  filterAnaImageFilesByFilenameTopic,
  normalizeAnaImageFilenameSearchText,
  userAskedForSpecificImageFilenameTopic,
} from '../utils/anaDocSendIntent.js';

const files = [
  { originalName: 'Quero_Meu_Ape_Pedra_do_Sol_Piscina_R00.jpg', relativeStoragePath: 'x/piscina.jpg' },
  { originalName: 'Quero_Meu_Ape_Pedra_do_Sol_Piscina_Solarium_R00.jpg', relativeStoragePath: 'x/solarium.jpg' },
  { originalName: 'Quero_Meu_Ape_Pedra_do_Sol_Playground_R00.jpg', relativeStoragePath: 'x/playground.jpg' },
  { originalName: 'Quero_Meu_Ape_Pedra_do_Sol_Portaria_R00.jpg', relativeStoragePath: 'x/portaria.jpg' },
  { originalName: 'Quero_Meu_Ape_Pedra_do_Sol_Academia_R00.jpg', relativeStoragePath: 'x/academia.jpg' },
];

test('normaliza nome de arquivo para busca por legenda implicita', () => {
  assert.equal(
    normalizeAnaImageFilenameSearchText('Quero_Meu_Ape-Pedra_do_Sol_Piscina_Solarium_R00.jpg'),
    'quero meu ape pedra do sol piscina solarium r00 jpg'
  );
});

test('pedido de piscina retorna apenas piscina e solarium', () => {
  const topic = extractAnaImageFilenameTopic('manda fotos da piscina');
  const selected = filterAnaImageFilesByFilenameTopic(files, topic).map((file) => file.originalName);

  assert.equal(topic, 'piscina');
  assert.deepEqual(selected, [
    'Quero_Meu_Ape_Pedra_do_Sol_Piscina_R00.jpg',
    'Quero_Meu_Ape_Pedra_do_Sol_Piscina_Solarium_R00.jpg',
  ]);
});

test('pedido de academia retorna apenas academia', () => {
  const topic = extractAnaImageFilenameTopic('quero ver a academia');
  const selected = filterAnaImageFilesByFilenameTopic(files, topic).map((file) => file.originalName);

  assert.equal(topic, 'academia');
  assert.deepEqual(selected, ['Quero_Meu_Ape_Pedra_do_Sol_Academia_R00.jpg']);
});

test('pedido de portaria retorna apenas portaria', () => {
  const topic = extractAnaImageFilenameTopic('tem foto da portaria?');
  const selected = filterAnaImageFilesByFilenameTopic(files, topic).map((file) => file.originalName);

  assert.equal(topic, 'portaria');
  assert.deepEqual(selected, ['Quero_Meu_Ape_Pedra_do_Sol_Portaria_R00.jpg']);
});

test('pedido generico de fotos nao aplica filtro por tema', () => {
  const topic = extractAnaImageFilenameTopic('manda fotos');
  const selected = filterAnaImageFilesByFilenameTopic(files, topic).map((file) => file.originalName);

  assert.equal(topic, null);
  assert.equal(selected.length, files.length);
});

test('pedido especifico sem arquivo correspondente permite fallback seguro', () => {
  const topic = extractAnaImageFilenameTopic('me manda fotos do pet place');
  const selected = filterAnaImageFilesByFilenameTopic(files, topic);

  assert.equal(topic, 'pet_place');
  assert.equal(selected.length, 0);
});

test('detecta pedido especifico mesmo sem palavra foto quando ha verbo visual/envio', () => {
  assert.equal(userAskedForSpecificImageFilenameTopic('manda a portaria'), true);
  assert.equal(userAskedForSpecificImageFilenameTopic('quero ver o playground'), true);
  assert.equal(userAskedForSpecificImageFilenameTopic('me fala da portaria'), false);
});
