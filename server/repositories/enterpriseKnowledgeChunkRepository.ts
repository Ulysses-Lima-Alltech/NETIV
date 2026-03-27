import { query } from '../db/pg.js';
import { splitTextIntoChunks } from '../utils/textChunker.js';

const MAX_CONTEXT_CHARS = 48_000;
/** Garante contexto mínimo no modo focado mesmo quando o overlap lexical com a mensagem é fraco. */
const MIN_CHUNKS_IN_PROMPT = 5;
const MAX_CHUNKS_IN_PROMPT = 16;

function normWords(s: string): Set<string> {
  const n = s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ');
  const set = new Set<string>();
  for (const w of n.split(/\s+/)) {
    if (w.length > 2) set.add(w);
  }
  return set;
}

function scoreChunk(hintWords: Set<string>, chunk: string): number {
  if (hintWords.size === 0) return 0;
  let hit = 0;
  const cw = normWords(chunk);
  for (const w of cw) {
    if (hintWords.has(w)) hit++;
  }
  return hit;
}

export async function replaceEnterpriseFileChunks(
  enterpriseId: number,
  enterpriseFileId: number,
  fullText: string | null | undefined
): Promise<void> {
  await query(`DELETE FROM enterprise_knowledge_chunks WHERE enterprise_file_id = $1`, [enterpriseFileId]);
  const chunks = splitTextIntoChunks((fullText || '').trim(), 1800);
  if (chunks.length === 0) return;
  for (let i = 0; i < chunks.length; i++) {
    await query(
      `INSERT INTO enterprise_knowledge_chunks (enterprise_id, enterprise_file_id, chunk_index, content)
       VALUES ($1, $2, $3, $4)`,
      [enterpriseId, enterpriseFileId, i, chunks[i]]
    );
  }
}

/**
 * Recupera trechos do book/documentos alinhados à mensagem atual (sobreposição lexical).
 * Só inclui arquivos ativos marcados como base de conhecimento.
 */
export async function loadRankedKnowledgeChunksForPrompt(
  enterpriseId: number,
  hintText: string
): Promise<string> {
  const hintWords = normWords(hintText);
  const { rows } = await query<{ content: string; original_name: string; chunk_index: number }>(
    `SELECT c.content, c.chunk_index, f.original_name
     FROM enterprise_knowledge_chunks c
     INNER JOIN enterprise_files f ON f.id = c.enterprise_file_id
     WHERE c.enterprise_id = $1
       AND f.is_active = true
       AND f.can_be_used_as_knowledge = true
     ORDER BY f.id, c.chunk_index`,
    [enterpriseId]
  );
  if (rows.length === 0) return '';

  const scored = rows.map((r, i) => ({
    ...r,
    score: hintWords.size === 0 ? 0 : scoreChunk(hintWords, r.content),
    dbOrder: i,
  }));
  if (hintWords.size > 0) scored.sort((a, b) => b.score - a.score || a.dbOrder - b.dbOrder);

  const used = new Set<string>();
  const parts: string[] = [];
  let n = 0;

  const pushRow = (r: (typeof scored)[0]) => {
    const key = `${r.original_name}#${r.chunk_index}`;
    if (used.has(key)) return false;
    used.add(key);
    const header = `\n--- ${r.original_name} (trecho) ---\n`;
    const piece = header + r.content;
    if (n + piece.length > MAX_CONTEXT_CHARS) return false;
    parts.push(piece);
    n += piece.length;
    return true;
  };

  let added = 0;
  for (const r of scored) {
    if (added >= MAX_CHUNKS_IN_PROMPT) break;
    if (r.score > 0 && pushRow(r)) added++;
  }

  if (added < MIN_CHUNKS_IN_PROMPT) {
    const byStable = [...scored].sort((a, b) => a.dbOrder - b.dbOrder);
    for (const r of byStable) {
      if (added >= MAX_CHUNKS_IN_PROMPT) break;
      if (added >= MIN_CHUNKS_IN_PROMPT && r.score === 0) {
        /* já temos o mínimo; não precisa continuar enchendo com trechos irrelevantes */
        break;
      }
      if (pushRow(r)) added++;
    }
  }

  return parts.join('\n').trim();
}

export { splitTextIntoChunks };
