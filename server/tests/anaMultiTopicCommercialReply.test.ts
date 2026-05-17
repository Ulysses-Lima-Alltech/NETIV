import assert from 'node:assert/strict';
import test from 'node:test';
import {
  finalizeAnaReplyText,
  evaluateAnaEmptyFallbackGuard,
  containsInternalLimitationLanguage,
} from '../utils/anaReplyFinalize.js';

test('mensagem em topicos recebe resposta comercial parcial segura sem linguagem interna', () => {
  const userMessage = 'localização\nlocal é pavimentado\nvalores';
  const rawReply =
    'O Evora fica em Atibaia. Nao tenho essa informacao liberada sobre pavimentacao. Sobre valores, nao consta na base.';
  const finalReply = finalizeAnaReplyText(rawReply, { userMessage, isFirstAnaReply: false });

  assert.match(finalReply.toLowerCase(), /atibaia|localizacao|localização/);
  assert.ok(finalReply.trim().length > 40);
  assert.match(finalReply.toLowerCase(), /\?/);
  assert.equal(containsInternalLimitationLanguage(finalReply), false);
  assert.doesNotMatch(finalReply.toLowerCase(), /nao tenho essa informacao liberada|nao tenho acesso|nao consta na base|material liberado|base da ana|nao fui autorizad/);
});

test('guard final nao bloqueia resposta parcial valida para multi-topico comercial', () => {
  const userMessage = 'localização\nlocal é pavimentado\nvalores';
  const reply =
    'O empreendimento fica em Atibaia.\n\nSobre a estrutura, e um empreendimento com infraestrutura planejada.\n\nEsses detalhes variam conforme as opcoes disponiveis. O corretor te passa tudo certinho no atendimento. Que tal marcarmos uma visita?';
  const guard = evaluateAnaEmptyFallbackGuard({
    reply,
    userMessage,
    isFirstAnaReply: false,
    knowledgeText: 'Empreendimento em Atibaia, com infraestrutura e lazer.',
  });
  assert.equal(guard.blocked, false);
  assert.equal(guard.reason, null);
});

test('ana nao oferece opcoes especificas que nao consegue sustentar', () => {
  const userMessage = 'quero saber mais';
  const rawReply = 'Voce quer saber planta dos lotes, modelos de construcao, simulacao ou desconto?';
  const finalReply = finalizeAnaReplyText(rawReply, { userMessage, isFirstAnaReply: false });
  assert.doesNotMatch(finalReply.toLowerCase(), /planta dos lotes|modelos de construcao|simulac|desconto/);
});


