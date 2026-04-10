import { randomUUID } from 'crypto';
import {
  listKnowledgeFilesForBackfill,
  reindexKnowledgeFileForBackfill,
  type ReindexKnowledgeBackfillResult,
} from '../repositories/enterpriseRepository.js';

type BackfillJobStatus = 'running' | 'completed' | 'failed';

export interface KnowledgeBackfillJobLog {
  ts: string;
  enterprise_id: number;
  enterprise_name: string;
  file_id: number;
  original_name: string;
  success: boolean;
  chunks_generated: number;
  extracted_chars: number;
  reason?: string;
}

export interface KnowledgeBackfillJob {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  status: BackfillJobStatus;
  dryRun: boolean;
  filterEnterpriseId: number | null;
  filterFileId: number | null;
  includeInactive: boolean;
  maxFiles: number | null;
  scannedFiles: number;
  successFiles: number;
  failedFiles: number;
  emptyExtractedTextFiles: number;
  totalChunksGenerated: number;
  error?: string;
  logs: KnowledgeBackfillJobLog[];
}

interface StartKnowledgeBackfillOpts {
  dryRun?: boolean;
  enterpriseId?: number;
  fileId?: number;
  includeInactive?: boolean;
  maxFiles?: number;
}

const jobs = new Map<string, KnowledgeBackfillJob>();
const MAX_LOGS_PER_JOB = 4000;

function toLog(r: ReindexKnowledgeBackfillResult): KnowledgeBackfillJobLog {
  return {
    ts: new Date().toISOString(),
    enterprise_id: r.enterpriseId,
    enterprise_name: r.enterpriseName,
    file_id: r.fileId,
    original_name: r.originalName,
    success: r.success,
    chunks_generated: r.chunksGenerated,
    extracted_chars: r.extractedChars,
    reason: r.reason,
  };
}

function appendLog(job: KnowledgeBackfillJob, log: KnowledgeBackfillJobLog): void {
  job.logs.push(log);
  if (job.logs.length > MAX_LOGS_PER_JOB) {
    job.logs.splice(0, job.logs.length - MAX_LOGS_PER_JOB);
  }
}

async function runJob(jobId: string): Promise<void> {
  const job = jobs.get(jobId);
  if (!job) return;
  try {
    const targets = await listKnowledgeFilesForBackfill({
      enterpriseId: job.filterEnterpriseId ?? undefined,
      fileId: job.filterFileId ?? undefined,
      includeInactive: job.includeInactive,
    });
    const selected =
      job.maxFiles != null && job.maxFiles > 0 ? targets.slice(0, job.maxFiles) : targets;
    job.scannedFiles = selected.length;

    for (const t of selected) {
      const r = await reindexKnowledgeFileForBackfill(t.fileId, { dryRun: job.dryRun });
      appendLog(job, toLog(r));
      if (r.success) {
        job.successFiles++;
        job.totalChunksGenerated += r.chunksGenerated;
        if (r.reason === 'empty_extracted_text') job.emptyExtractedTextFiles++;
      } else {
        job.failedFiles++;
      }
    }
    job.status = 'completed';
    job.finishedAt = new Date().toISOString();
  } catch (e) {
    job.status = 'failed';
    job.error = e instanceof Error ? e.message : String(e);
    job.finishedAt = new Date().toISOString();
  }
}

export function startKnowledgeBackfill(opts: StartKnowledgeBackfillOpts = {}): string {
  const jobId = randomUUID();
  const job: KnowledgeBackfillJob = {
    id: jobId,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    status: 'running',
    dryRun: !!opts.dryRun,
    filterEnterpriseId: opts.enterpriseId ?? null,
    filterFileId: opts.fileId ?? null,
    includeInactive: !!opts.includeInactive,
    maxFiles: opts.maxFiles ?? null,
    scannedFiles: 0,
    successFiles: 0,
    failedFiles: 0,
    emptyExtractedTextFiles: 0,
    totalChunksGenerated: 0,
    logs: [],
  };
  jobs.set(jobId, job);
  runJob(jobId).catch(() => {});
  return jobId;
}

export function getKnowledgeBackfillJob(jobId: string): KnowledgeBackfillJob | null {
  return jobs.get(jobId) ?? null;
}

export function listKnowledgeBackfillJobs(): KnowledgeBackfillJob[] {
  return Array.from(jobs.values());
}

export function deleteKnowledgeBackfillJob(jobId: string): boolean {
  return jobs.delete(jobId);
}
