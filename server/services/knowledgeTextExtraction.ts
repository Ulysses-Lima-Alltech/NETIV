export type ExtractedTextSource =
  | 'plain_text'
  | 'markdown'
  | 'html'
  | 'pdf'
  | 'docx'
  | 'unsupported';

export interface ExtractTextResult {
  text: string;
  source: ExtractedTextSource;
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function stripHtmlToText(html: string): string {
  const noScripts = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gim, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gim, ' ');

  const withLineBreaks = noScripts
    .replace(/<\s*br\s*\/?>/gim, '\n')
    .replace(/<\s*\/p\s*>/gim, '\n\n')
    .replace(/<\s*\/div\s*>/gim, '\n');

  const noTags = withLineBreaks.replace(/<[^>]+>/g, ' ');
  return decodeHtmlEntities(noTags);
}

export function normalizeKnowledgeText(text: string): string {
  return String(text || '')
    .replace(/\u0000/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function extractTextFromBufferV1(
  buffer: Buffer,
  mimeType: string,
  originalName: string
): Promise<ExtractTextResult> {
  const lowerName = String(originalName || '').toLowerCase();
  const mime = String(mimeType || '').toLowerCase();

  if (
    mime.startsWith('text/plain') ||
    lowerName.endsWith('.txt')
  ) {
    return { text: normalizeKnowledgeText(buffer.toString('utf-8')), source: 'plain_text' };
  }

  if (
    mime.startsWith('text/markdown') ||
    lowerName.endsWith('.md')
  ) {
    return { text: normalizeKnowledgeText(buffer.toString('utf-8')), source: 'markdown' };
  }

  if (
    mime.startsWith('text/html') ||
    lowerName.endsWith('.html') ||
    lowerName.endsWith('.htm')
  ) {
    return {
      text: normalizeKnowledgeText(stripHtmlToText(buffer.toString('utf-8'))),
      source: 'html',
    };
  }

  if (mime.includes('pdf') || lowerName.endsWith('.pdf')) {
    const pdfParse = (await import('pdf-parse')).default;
    const parsed = await pdfParse(buffer);
    return {
      text: normalizeKnowledgeText(parsed.text || ''),
      source: 'pdf',
    };
  }

  if (
    mime.includes('wordprocessingml') ||
    mime.includes('application/msword') ||
    lowerName.endsWith('.docx')
  ) {
    const mammoth = await import('mammoth');
    const extracted = await mammoth.extractRawText({ buffer });
    return {
      text: normalizeKnowledgeText(extracted.value || ''),
      source: 'docx',
    };
  }

  return {
    text: '',
    source: 'unsupported',
  };
}

