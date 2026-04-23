import { createHash } from 'crypto';

export interface ChunkingOptions {
  chunkSize: number;
  overlap: number;
}

function findBreakpoint(text: string, start: number, idealEnd: number): number {
  const searchStart = Math.max(start + 1, idealEnd - 220);
  const window = text.slice(searchStart, idealEnd);

  const lineBreak = window.lastIndexOf('\n');
  if (lineBreak >= 0) return searchStart + lineBreak;

  const sentenceBreak = Math.max(window.lastIndexOf('. '), window.lastIndexOf('! '), window.lastIndexOf('? '));
  if (sentenceBreak >= 0) return searchStart + sentenceBreak + 1;

  const spaceBreak = window.lastIndexOf(' ');
  if (spaceBreak >= 0) return searchStart + spaceBreak;

  return idealEnd;
}

export function buildKnowledgeChunks(
  normalizedText: string,
  options: ChunkingOptions = { chunkSize: 1400, overlap: 180 }
): string[] {
  const text = String(normalizedText || '').trim();
  if (!text) return [];

  const chunkSize = Math.max(1200, Math.min(1500, options.chunkSize));
  const overlap = Math.max(150, Math.min(200, options.overlap));

  const chunks: string[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const idealEnd = Math.min(cursor + chunkSize, text.length);
    let end = idealEnd;

    if (idealEnd < text.length) {
      end = findBreakpoint(text, cursor, idealEnd);
      if (end <= cursor + 200) {
        end = idealEnd;
      }
    }

    const raw = text.slice(cursor, end).trim();
    if (raw) chunks.push(raw);

    if (end >= text.length) break;

    const nextCursor = Math.max(0, end - overlap);
    if (nextCursor <= cursor) {
      cursor = end;
    } else {
      cursor = nextCursor;
    }
  }

  return chunks;
}

export function hashNormalizedText(normalizedText: string): string {
  return createHash('sha256').update(normalizedText, 'utf-8').digest('hex');
}

