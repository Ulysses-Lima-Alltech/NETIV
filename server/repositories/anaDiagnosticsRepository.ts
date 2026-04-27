import { query } from '../db/pg.js';

export interface AnaDiagnosticRow {
  id: number;
  diagnostic_type: string;
  provider: string;
  model: string | null;
  ok: boolean;
  status: number | null;
  classified_error: string | null;
  sanitized_message: string | null;
  payload_json: unknown;
  created_at: Date;
}

export async function createAnaDiagnostic(input: {
  diagnosticType: string;
  provider: string;
  model?: string | null;
  ok: boolean;
  status?: number | null;
  classifiedError?: string | null;
  sanitizedMessage?: string | null;
  payloadJson?: unknown;
}): Promise<AnaDiagnosticRow> {
  const { rows } = await query<AnaDiagnosticRow>(
    `INSERT INTO ana_diagnostics (
       diagnostic_type,
       provider,
       model,
       ok,
       status,
       classified_error,
       sanitized_message,
       payload_json
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
     RETURNING *`,
    [
      input.diagnosticType,
      input.provider,
      input.model ?? null,
      input.ok === true,
      input.status ?? null,
      input.classifiedError ?? null,
      input.sanitizedMessage ?? null,
      JSON.stringify(input.payloadJson ?? {}),
    ]
  );
  return rows[0]!;
}
