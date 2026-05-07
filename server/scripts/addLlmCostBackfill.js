#!/usr/bin/env node
import 'dotenv/config';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import dotenv from 'dotenv';
import pg from 'pg';

const { Pool } = pg;

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const part = argv[i];
    if (!part.startsWith('--')) continue;
    const key = part.slice(2);
    const next = argv[i + 1];
    if (next == null || next.startsWith('--')) {
      args[key] = 'true';
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function loadLocalEnvFallback() {
  const candidates = [
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), '.env.local'),
    resolve(process.cwd(), '.env.development'),
    resolve(process.cwd(), 'server', '.env'),
    resolve(process.cwd(), 'server', '.env.local'),
  ];
  for (const file of candidates) {
    if (existsSync(file)) dotenv.config({ path: file, override: false });
  }
}

function requireText(args, key) {
  const value = String(args[key] ?? '').trim();
  if (!value) throw new Error(`Parametro obrigatorio ausente: --${key}`);
  return value;
}

function requireDate(args, key) {
  const value = requireText(args, key);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Parametro --${key} invalido: ${value}`);
  return value;
}

function requireMoney(args) {
  const value = requireText(args, 'total-cost-usd');
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new Error('Parametro --total-cost-usd deve ser numerico e >= 0.');
  }
  return number;
}

async function main() {
  loadLocalEnvFallback();
  const args = parseArgs(process.argv);
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL nao configurado.');

  const label = requireText(args, 'label');
  const start = requireDate(args, 'start');
  const end = requireDate(args, 'end');
  const totalCostUsd = requireMoney(args);
  const notes = args.notes == null ? null : String(args.notes);

  if (new Date(end).getTime() <= new Date(start).getTime()) {
    throw new Error('Parametro --end deve ser maior que --start.');
  }

  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const { rows } = await pool.query(
      `INSERT INTO llm_cost_backfills (
         label,
         start_at,
         end_at,
         total_cost_usd,
         allocation_method,
         source,
         notes,
         metadata
       )
       VALUES ($1, $2::timestamptz, $3::timestamptz, $4::numeric, 'effort_messages_audit', 'manual_billing', $5, $6::jsonb)
       RETURNING id, label, start_at, end_at, total_cost_usd`,
      [label, start, end, totalCostUsd, notes, JSON.stringify({ insertedByScript: true })]
    );

    const row = rows[0];
    console.log(
      `Backfill inserido: id=${row.id} label="${row.label}" periodo=${row.start_at.toISOString()}..${row.end_at.toISOString()} total_usd=${Number(row.total_cost_usd).toFixed(2)}`
    );
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
