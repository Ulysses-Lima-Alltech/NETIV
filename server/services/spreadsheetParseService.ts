import { parse } from 'csv-parse/sync';
import * as XLSX from 'xlsx';

export interface ParsedSpreadsheet {
  headers: string[];
  rows: Record<string, string>[];
  rowCount: number;
  sampleRows: Record<string, string>[];
}

function normalizeCellValue(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
}

function parseCsv(buffer: Buffer): ParsedSpreadsheet {
  const text = buffer.toString('utf-8').replace(/^\uFEFF/, '');
  const records = parse(text, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    bom: true,
    trim: true,
  }) as Record<string, unknown>[];
  const headers = records.length > 0 ? Object.keys(records[0] ?? {}) : [];
  const rows = records.map((record) => {
    const normalized: Record<string, string> = {};
    for (const key of headers) normalized[key] = normalizeCellValue(record[key]);
    return normalized;
  });
  return { headers, rows, rowCount: rows.length, sampleRows: rows.slice(0, 10) };
}

function parseXlsx(buffer: Buffer): ParsedSpreadsheet {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return { headers: [], rows: [], rowCount: 0, sampleRows: [] };
  const worksheet = workbook.Sheets[firstSheetName];
  const jsonRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
    defval: '',
    raw: false,
  });
  const headers = jsonRows.length > 0 ? Object.keys(jsonRows[0] ?? {}) : [];
  const rows = jsonRows.map((record) => {
    const normalized: Record<string, string> = {};
    for (const key of headers) normalized[key] = normalizeCellValue(record[key]);
    return normalized;
  });
  return { headers, rows, rowCount: rows.length, sampleRows: rows.slice(0, 10) };
}

export function parseSpreadsheet(fileBuffer: Buffer, fileName: string, mimeType?: string | null): ParsedSpreadsheet {
  const lowerName = String(fileName || '').toLowerCase();
  const mt = String(mimeType || '').toLowerCase();
  if (lowerName.endsWith('.xlsx') || mt.includes('spreadsheetml')) return parseXlsx(fileBuffer);
  return parseCsv(fileBuffer);
}
