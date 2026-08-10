import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildAnaSpecificMediaUnavailableReply,
  extractAnaImageFilenameTopic,
  extractAnaSpecificMediaSpace,
  filterAnaMediaFilesBySpecificSpace,
  filterAnaImageFilesByFilenameTopic,
  listAnaSpecificMediaSpacesAvailableFromFiles,
  normalizeAnaImageFilenameSearchText,
  userAskedForSpecificMediaSpace,
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

const specificMediaFiles = [
  { originalName: 'Vídeo_Piscina-Solarium.mp4', relativeStoragePath: 'videos/piscina_solarium.mp4' },
  { originalName: 'FOTO_ACADEMIA_360.JPG', relativeStoragePath: 'images/academia-360.jpg' },
  { originalName: 'Planta_Implantação_Geral.pdf', relativeStoragePath: 'docs/planta_implantacao.pdf' },
  { originalName: 'Mapa_Localização_Empreendimento.png', relativeStoragePath: 'images/mapa-localizacao.png' },
  { originalName: 'Foto_Portaria.jpg', relativeStoragePath: 'images/portaria.jpg' },
];

test('mídia específica normaliza acentos, espaços, hífens, underscores e caixa', () => {
  assert.equal(extractAnaSpecificMediaSpace('QUERO VÍDEO da piscina-solarium'), 'piscina');
  assert.equal(extractAnaSpecificMediaSpace('mostra a FOTO_ACADEMIA_360'), 'academia');
  assert.equal(extractAnaSpecificMediaSpace('quero ver a planta implantação'), 'planta');
  assert.equal(extractAnaSpecificMediaSpace('me mostra o MAPA de localização'), 'mapa_localizacao');
});

test('filtro de mídia específica não mistura ambientes, foto, vídeo, planta e mapa', () => {
  const piscina = filterAnaMediaFilesBySpecificSpace(specificMediaFiles, 'piscina');
  const planta = filterAnaMediaFilesBySpecificSpace(specificMediaFiles, 'planta');
  const mapa = filterAnaMediaFilesBySpecificSpace(specificMediaFiles, 'mapa_localizacao');

  assert.deepEqual(piscina.map((file) => file.originalName), ['Vídeo_Piscina-Solarium.mp4']);
  assert.deepEqual(planta.map((file) => file.originalName), ['Planta_Implantação_Geral.pdf']);
  assert.deepEqual(mapa.map((file) => file.originalName), ['Mapa_Localização_Empreendimento.png']);
  assert.equal(filterAnaMediaFilesBySpecificSpace(specificMediaFiles, 'churrasqueira').length, 0);
});

test('lista espaços disponíveis e produz fallback específico seguro quando não há mídia', () => {
  const available = listAnaSpecificMediaSpacesAvailableFromFiles(specificMediaFiles, 4);
  const reply = buildAnaSpecificMediaUnavailableReply({
    requestedSpace: 'churrasqueira',
    mediaKind: 'foto',
    enterpriseName: 'Pedra do Sol',
    availableSpaces: available,
  });

  assert.deepEqual(available, ['mapa_localizacao', 'piscina', 'academia', 'portaria']);
  assert.match(reply, /não tenho fotos específicas da churrasqueira cadastradas/i);
  assert.match(reply, /Pedra do Sol/);
  assert.match(reply, /piscina/);
});

test('pedido genérico preserva fluxo genérico e pedidos específicos exigem intenção visual', () => {
  assert.equal(userAskedForSpecificMediaSpace('manda fotos'), false);
  assert.equal(userAskedForSpecificMediaSpace('me fala da piscina'), false);
  assert.equal(userAskedForSpecificMediaSpace('manda vídeo da piscina'), true);
  assert.equal(userAskedForSpecificMediaSpace('quero ver a planta'), true);
  assert.equal(userAskedForSpecificMediaSpace('me mostra o mapa'), true);
  assert.equal(filterAnaMediaFilesBySpecificSpace(specificMediaFiles, null).length, specificMediaFiles.length);
});
