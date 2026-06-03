import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  buildGreetingSafeFallback,
  evaluateAnaEmptyFallbackGuard,
  finalizeAnaReplyText,
  pickRandomGreetingReply,
} from '../utils/anaReplyFinalize.js';

test('caso 1: saudacao com contexto de empreendimento nao pode virar resposta isolada', () => {
  const guard = evaluateAnaEmptyFallbackGuard({
    reply: 'Oi, tudo bem sim! E com voce?',
    userMessage: 'oi, tudo bem?',
    isFirstAnaReply: false,
    knowledgeText: 'Empreendimento: Evora. Cidade: Atibaia. Tema recente: valores e visita.',
  });
  assert.equal(guard.blocked, true);
  assert.equal(guard.reason, 'isolated_greeting_without_contextual_followup');
});

test('caso 2: sem empreendimento identificado, resposta deve continuar atendimento e nao cair em saudacao isolada', () => {
  const guard = evaluateAnaEmptyFallbackGuard({
    reply: 'Oi, tudo bem sim! Voce prefere me contar a cidade ou o empreendimento de interesse?',
    userMessage: 'oi, tudo bem?',
    isFirstAnaReply: true,
    knowledgeText: '',
  });
  assert.equal(guard.blocked, false);
});

test('caso 3: pergunta explicita sobre Evora nao deve induzir triagem generica', () => {
  const guard = evaluateAnaEmptyFallbackGuard({
    reply: 'O Evora e um loteamento fechado em Atibaia com foco em seguranca e lazer. Voce prefere começar por valores, localizacao ou visita?',
    userMessage: 'quero saber mais sobre o Evora',
    isFirstAnaReply: false,
    knowledgeText: 'Evora em Atibaia.',
  });
  assert.equal(guard.blocked, false);
});

test('caso 4: sanitizador remove saudacao duplicada sem criar nova resposta', () => {
  const out = finalizeAnaReplyText('Oi! Olá! Como posso ajudar?', { userMessage: 'oi' });
  assert.equal(out, 'Oi! Como posso ajudar?');
});

test('caso 5: frase generica proibida nao existe hardcoded no projeto', () => {
  const rootFiles = [
    new URL('../utils/anaReplyFinalize.ts', import.meta.url),
    new URL('../services/conversationEngine.ts', import.meta.url),
    new URL('../services/anaAgentService.ts', import.meta.url),
  ];
  const banned = 'Como posso te ajudar a conhecer nossos empreendimentos em São Paulo?';
  for (const fileUrl of rootFiles) {
    const source = readFileSync(fileUrl, 'utf8');
    assert.equal(source.includes(banned), false);
  }
});

test('caso 6: sem resposta segura nao cria fallback textual generico', () => {
  assert.equal(buildGreetingSafeFallback(null), '');
  assert.equal(pickRandomGreetingReply(null), '');
});
