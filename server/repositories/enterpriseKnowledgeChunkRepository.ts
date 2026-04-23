import { query } from '../db/pg.js';
import { splitTextIntoChunks } from '../utils/textChunker.js';
import {
  classifyKnowledgeChunk,
  type KnowledgeBlock,
  type TemporalStatus,
} from '../utils/knowledgeChunkClassifier.js';

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

function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

type QuestionProfile = {
  desiredBlocks: KnowledgeBlock[];
  desiredIntentTags: string[];
  preferCurrentVariableData: boolean;
  citySensitive: boolean;
};

function detectQuestionProfile(hintText: string): QuestionProfile {
  const n = normalizeText(hintText);
  const hasFinance = /(preco|valor|condic|pagamento|entrada|parcela|juros|taxa)/.test(n);
  const hasInvest = /(invest|valoriz|retorno)/.test(n);
  const hasMorar = /(morar|moradia|familia|fam[íi]lia|residir|morar com)/.test(n);
  const hasMaterial = /(book|material|catalog|pdf|apresenta)/.test(n);
  const hasLocation = /(onde fica|localiz|cidade|bairro|endereco|mapa|acesso)/.test(n);
  const hasRules = /(pode|nao pode|não pode|negociar|prometer|handoff|corretor)/.test(n);

  const desiredBlocks: KnowledgeBlock[] = ['facts', 'commercial_intent'];
  const desiredIntentTags: string[] = [];
  if (hasFinance) {
    desiredBlocks.unshift('variable_data');
    desiredIntentTags.push('financeiro');
  }
  if (hasInvest) {
    desiredBlocks.unshift('commercial_intent');
    desiredIntentTags.push('investir');
  }
  if (hasMorar) {
    desiredBlocks.unshift('commercial_intent');
    desiredIntentTags.push('morar');
  }
  if (hasMaterial) {
    desiredBlocks.unshift('commercial_intent');
    desiredIntentTags.push('material');
  }
  if (hasLocation) {
    desiredBlocks.unshift('facts');
    desiredIntentTags.push('localizacao');
  }
  if (hasRules || hasFinance || hasLocation) {
    desiredBlocks.unshift('ana_rules');
  }

  return {
    desiredBlocks: [...new Set(desiredBlocks)],
    desiredIntentTags: [...new Set(desiredIntentTags)],
    preferCurrentVariableData: hasFinance,
    citySensitive: hasLocation,
  };
}

function blockBoost(block: KnowledgeBlock, profile: QuestionProfile): number {
  const idx = profile.desiredBlocks.indexOf(block);
  if (idx < 0) return 0;
  return Math.max(0, 24 - idx * 6);
}

function temporalBoost(status: TemporalStatus, profile: QuestionProfile): number {
  if (!profile.preferCurrentVariableData) return 0;
  if (status === 'current') return 14;
  if (status === 'time_sensitive') return 6;
  if (status === 'expired') return -10;
  return 0;
}

function cityBoost(
  rowCityHint: string | null | undefined,
  targetCity: string | null | undefined,
  profile: QuestionProfile
): number {
  if (!profile.citySensitive) return 0;
  const chunkCity = normalizeText(rowCityHint || '');
  const goalCity = normalizeText(targetCity || '');
  if (!goalCity) return 0;
  if (!chunkCity) return -2;
  return chunkCity === goalCity ? 14 : -10;
}

function intentTagBoost(tags: string[] | null | undefined, profile: QuestionProfile): number {
  const wanted = new Set(profile.desiredIntentTags);
  if (wanted.size === 0) return 0;
  const arr = tags || [];
  let hits = 0;
  for (const t of arr) {
    if (wanted.has(t)) hits++;
  }
  return hits * 5;
}

export async function replaceEnterpriseFileChunks(
  enterpriseId: number,
  enterpriseFileId: number,
  fullText: string | null | undefined,
  context?: { enterpriseName?: string | null; enterpriseCity?: string | null }
): Promise<void> {
  await query(`DELETE FROM enterprise_knowledge_chunks WHERE enterprise_file_id = $1`, [enterpriseFileId]);
  const chunks = splitTextIntoChunks((fullText || '').trim(), 1800);
  if (chunks.length === 0) return;
  for (let i = 0; i < chunks.length; i++) {
    const meta = classifyKnowledgeChunk(chunks[i] || '', {
      enterpriseName: context?.enterpriseName ?? null,
      enterpriseCity: context?.enterpriseCity ?? null,
    });
    try {
      await query(
        `INSERT INTO enterprise_knowledge_chunks
          (enterprise_id, enterprise_file_id, chunk_index, content,
           knowledge_block, block_priority, city_hint, enterprise_hint, intent_tags, temporal_status, source_confidence)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::text[], $10, $11)`,
        [
          enterpriseId,
          enterpriseFileId,
          i,
          chunks[i],
          meta.knowledge_block,
          meta.block_priority,
          meta.city_hint ?? null,
          meta.enterprise_hint ?? null,
          meta.intent_tags,
          meta.temporal_status,
          meta.source_confidence,
        ]
      );
    } catch {
      // Fallback legado: banco sem migration de metadados ainda aplicada.
      await query(
        `INSERT INTO enterprise_knowledge_chunks (enterprise_id, enterprise_file_id, chunk_index, content)
         VALUES ($1, $2, $3, $4)`,
        [enterpriseId, enterpriseFileId, i, chunks[i]]
      );
    }
  }
}

/**
 * Recupera trechos do book/documentos alinhados à mensagem atual (sobreposição lexical).
 * Só inclui arquivos ativos marcados como base de conhecimento.
 */
export async function loadRankedKnowledgeChunksForPrompt(
  enterpriseId: number,
  hintText: string,
  opts?: { targetCity?: string | null }
): Promise<string> {
  const profile = detectQuestionProfile(hintText);
  const hintWords = normWords(hintText);
  let rows: Array<{
    content: string;
    original_name: string;
    chunk_index: number;
    knowledge_block: KnowledgeBlock | null;
    block_priority: number | null;
    city_hint: string | null;
    intent_tags: string[] | null;
    temporal_status: TemporalStatus | null;
    source_confidence: number | null;
    source_priority: number | null;
  }> = [];
  try {
    const q = await query<{
      content: string;
      original_name: string;
      chunk_index: number;
      knowledge_block: KnowledgeBlock | null;
      block_priority: number | null;
      city_hint: string | null;
      intent_tags: string[] | null;
      temporal_status: TemporalStatus | null;
      source_confidence: number | null;
      source_priority: number | null;
    }>(
      `SELECT c.content, c.chunk_index, f.original_name,
              c.knowledge_block, c.block_priority, c.city_hint, c.intent_tags, c.temporal_status, c.source_confidence,
              COALESCE(v.source_priority, 0) AS source_priority
       FROM enterprise_knowledge_chunks c
       INNER JOIN enterprise_files f ON f.id = c.enterprise_file_id
       INNER JOIN enterprise_file_versions v
         ON v.id = c.enterprise_file_version_id
        AND v.enterprise_file_id = f.id
       WHERE c.enterprise_id = $1
         AND c.is_active = true
         AND f.current_version_id = c.enterprise_file_version_id
         AND COALESCE(v.storage_provider, '') = 's3'
         AND COALESCE(v.is_active, f.is_active, true) = true
         AND COALESCE(v.can_be_used_as_knowledge, f.can_be_used_as_knowledge, false) = true
         AND COALESCE(v.processing_status, 'PENDING') IN ('PROCESSED', 'SKIPPED')
       ORDER BY COALESCE(v.source_priority, 0) DESC, f.id, c.chunk_index`,
      [enterpriseId]
    );
    rows = q.rows;
  } catch (error) {
    console.error('[KNOWLEDGE_CHUNKS_QUERY_FAILED]', {
      enterpriseId,
      error: error instanceof Error ? error.message : String(error),
      message: 'Consulta S3-only de chunks falhou; nenhum fallback legado será aplicado.',
    });
    rows = [];
  }
  if (rows.length === 0) return '';

  const scored = rows.map((r, i) => ({
    ...r,
    score:
      (hintWords.size === 0 ? 0 : scoreChunk(hintWords, r.content) * 3) +
      blockBoost(r.knowledge_block ?? 'facts', profile) +
      intentTagBoost(r.intent_tags, profile) +
      temporalBoost(r.temporal_status ?? 'atemporal', profile) +
      cityBoost(r.city_hint, opts?.targetCity ?? null, profile) +
      Math.max(0, Math.min(8, Math.round((r.source_confidence ?? 0) / 12))) +
      Math.max(0, Math.min(20, Math.round((r.source_priority ?? 0) / 20))),
    dbOrder: i,
  }));
  if (hintWords.size > 0) scored.sort((a, b) => b.score - a.score || a.dbOrder - b.dbOrder);

  const used = new Set<string>();
  const byBlock: Record<KnowledgeBlock, string[]> = {
    ana_rules: [],
    variable_data: [],
    commercial_intent: [],
    facts: [],
  };
  let n = 0;
  const pushRow = (r: (typeof scored)[0]) => {
    const key = `${r.original_name}#${r.chunk_index}`;
    if (used.has(key)) return false;
    used.add(key);
    const label =
      r.knowledge_block === 'ana_rules'
        ? 'REGRAS_ANA'
        : r.knowledge_block === 'variable_data'
          ? 'DADOS_VARIAVEIS'
          : r.knowledge_block === 'commercial_intent'
            ? 'INTENCOES_COMERCIAIS'
            : 'FATOS_EMPREENDIMENTO';
    const header = `\n--- [${label}] ${r.original_name} (trecho) ---\n`;
    const piece = header + r.content;
    if (n + piece.length > MAX_CONTEXT_CHARS) return false;
    const block = r.knowledge_block ?? 'facts';
    byBlock[block].push(piece);
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
  const parts: string[] = [];
  const order: Array<[KnowledgeBlock, string]> = [
    ['ana_rules', 'BLOCO 4 — REGRAS DA ANA'],
    ['variable_data', 'BLOCO 3 — DADOS VARIAVEIS'],
    ['commercial_intent', 'BLOCO 2 — INTENCOES COMERCIAIS'],
    ['facts', 'BLOCO 1 — FATOS DO EMPREENDIMENTO'],
  ];
  for (const [block, title] of order) {
    if (byBlock[block].length === 0) continue;
    parts.push(`\n### ${title}\n${byBlock[block].join('\n')}`);
  }
  return parts.join('\n').trim();
}

export { splitTextIntoChunks };
