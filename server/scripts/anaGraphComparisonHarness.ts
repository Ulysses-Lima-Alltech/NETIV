import 'dotenv/config';
import { writeFileSync } from 'fs';
import { MemorySaver } from '@langchain/langgraph';
import { query } from '../db/pg.js';
import { compileAnaGraph } from '../services/anaGraph/graph.js';
import { buildShadowDeps } from '../services/anaGraph/shadowRunner.js';

/**
 * Harness de comparação (fase 10) — SOMENTE LEITURA no banco de produção.
 * Recupera turnos reais recentes, reexecuta cada um isoladamente pelo grafo
 * novo (checkpointer em memória, deps do modo sombra — zero escrita/envio) e
 * compara com o que o motor legado de fato respondeu na época. Não é
 * exaustivo: prioriza sinal rápido sobre cobertura completa.
 *
 * Uso: tsx scripts/anaGraphComparisonHarness.ts [limiteConversas]
 * Saída: arquivo JSON local (nunca grava nada no banco).
 */

interface ConversationSample {
  id: number;
  enterprise_id: number | null;
  contact_id: number | null;
  contact_phone: string | null;
}

interface MessageRow {
  id: number;
  role: 'user' | 'assistant';
  content: string | null;
  created_at: Date;
}

interface TurnComparison {
  conversationId: number;
  userMessageId: number;
  userMessage: string;
  legacyReply: string | null;
  graphReply: string | null;
  repliesMatch: boolean;
  graphPrimaryAxis: string | null;
  graphAutomationBlocked: boolean;
  error: string | null;
}

async function fetchRecentConversationSamples(limit: number): Promise<ConversationSample[]> {
  const { rows } = await query<ConversationSample>(
    `SELECT id, enterprise_id, contact_id, contact_phone
       FROM conversations
      WHERE conversation_type = 'CLIENT'
        AND COALESCE(handoff, false) = false
      ORDER BY last_message_at DESC NULLS LAST
      LIMIT $1`,
    [limit]
  );
  return rows;
}

async function fetchOrderedMessages(conversationId: number): Promise<MessageRow[]> {
  const { rows } = await query<MessageRow>(
    `SELECT id, role, content, created_at
       FROM messages
      WHERE conversation_id = $1
        AND deleted_at IS NULL
        AND role IN ('user', 'assistant')
      ORDER BY created_at ASC, id ASC
      LIMIT 40`,
    [conversationId]
  );
  return rows;
}

/** Para cada mensagem de usuário, encontra a próxima resposta de assistente (resposta real do motor legado). */
function pairUserTurnsWithLegacyReply(
  messages: MessageRow[]
): Array<{ userMessage: MessageRow; legacyReply: MessageRow | null }> {
  const pairs: Array<{ userMessage: MessageRow; legacyReply: MessageRow | null }> = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role !== 'user') continue;
    const next = messages.slice(i + 1).find((m) => m.role === 'assistant' || m.role === 'user');
    pairs.push({
      userMessage: msg,
      legacyReply: next?.role === 'assistant' ? next : null,
    });
  }
  return pairs;
}

async function runComparisonForConversation(
  conversation: ConversationSample
): Promise<TurnComparison[]> {
  const messages = await fetchOrderedMessages(conversation.id);
  const pairs = pairUserTurnsWithLegacyReply(messages).slice(-3); // últimos 3 turnos por conversa — sinal rápido, não exaustivo

  const results: TurnComparison[] = [];
  for (const pair of pairs) {
    const runId = `harness-${conversation.id}-${pair.userMessage.id}`;
    try {
      const app = compileAnaGraph(buildShadowDeps(runId), new MemorySaver());
      const output = await app.invoke(
        {
          conversationId: conversation.id,
          contactId: conversation.contact_id,
          enterpriseId: conversation.enterprise_id,
          userMessage: pair.userMessage.content ?? '',
          metaMessageId: null,
          phoneNumberId: null,
        },
        { configurable: { thread_id: `${runId}-${Date.now()}` } }
      );

      const legacyText = pair.legacyReply?.content ?? null;
      const graphText = output.assistantReplyText;
      results.push({
        conversationId: conversation.id,
        userMessageId: pair.userMessage.id,
        userMessage: pair.userMessage.content ?? '',
        legacyReply: legacyText,
        graphReply: graphText,
        repliesMatch: legacyText != null && graphText != null && legacyText.trim() === graphText.trim(),
        graphPrimaryAxis: output.lastDecision?.primaryAxis ?? null,
        graphAutomationBlocked: output.automationBlockedByHandoff,
        error: null,
      });
    } catch (error) {
      results.push({
        conversationId: conversation.id,
        userMessageId: pair.userMessage.id,
        userMessage: pair.userMessage.content ?? '',
        legacyReply: pair.legacyReply?.content ?? null,
        graphReply: null,
        repliesMatch: false,
        graphPrimaryAxis: null,
        graphAutomationBlocked: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}

async function run(): Promise<void> {
  const limitArg = Number.parseInt(process.argv[2] ?? '', 10);
  const conversationLimit = Number.isFinite(limitArg) && limitArg > 0 ? limitArg : 10;

  console.log(`[anaGraph-harness] iniciando — somente leitura, conversas=${conversationLimit}`);
  const conversations = await fetchRecentConversationSamples(conversationLimit);
  console.log(`[anaGraph-harness] conversas encontradas=${conversations.length}`);

  const allResults: TurnComparison[] = [];
  for (const conversation of conversations) {
    const results = await runComparisonForConversation(conversation);
    allResults.push(...results);
    console.log(`[anaGraph-harness] conversationId=${conversation.id} turnos=${results.length}`);
  }

  const matched = allResults.filter((r) => r.repliesMatch).length;
  const errored = allResults.filter((r) => r.error != null).length;
  const summary = {
    generatedAt: new Date().toISOString(),
    totalTurns: allResults.length,
    exactTextMatches: matched,
    errors: errored,
    note:
      'Divergência de texto é esperada nesta fase: vários inputs de decisionPolicy/ragAnswer ainda usam defaults conservadores (gap documentado nas fases 4/5c/5d), não fidelidade total ao motor legado.',
  };

  const outPath = `anagraph-harness-report-${Date.now()}.json`;
  writeFileSync(outPath, JSON.stringify({ summary, results: allResults }, null, 2), 'utf8');
  console.log('[anaGraph-harness] resumo:', summary);
  console.log(`[anaGraph-harness] relatório salvo em: ${outPath}`);
}

run().catch((error) => {
  console.error('[anaGraph-harness] erro fatal:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
