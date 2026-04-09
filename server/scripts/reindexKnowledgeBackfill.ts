#!/usr/bin/env tsx

import { startKnowledgeBackfill, listKnowledgeBackfillJobs, deleteKnowledgeBackfillJob } from '../services/knowledgeBackfillService.js';
import { listKnowledgeFilesForBackfill } from '../repositories/enterpriseRepository.js';

const args = process.argv.slice(2);
const command = args[0];

async function main(): Promise<void> {
  switch (command) {
    case 'start': {
      const dryRun = args.includes('--dry-run');
      const enterpriseId = (() => {
        const idx = args.findIndex(a => a === '--enterprise');
        return idx >= 0 && idx + 1 < args.length ? parseInt(args[idx + 1], 10) : undefined;
      })();
      const fileId = (() => {
        const idx = args.findIndex(a => a === '--file');
        return idx >= 0 && idx + 1 < args.length ? parseInt(args[idx + 1], 10) : undefined;
      })();
      const maxFiles = (() => {
        const idx = args.findIndex(a => a === '--max');
        return idx >= 0 && idx + 1 < args.length ? parseInt(args[idx + 1], 10) : undefined;
      })();

      console.log('Iniciando reindexação de conhecimento...');
      console.log({ dryRun, enterpriseId, fileId, maxFiles });

      const jobId = startKnowledgeBackfill({
        dryRun,
        enterpriseId,
        fileId,
        maxFiles,
        includeInactive: false,
      });

      console.log(`Job iniciado com ID: ${jobId}`);
      console.log('Para acompanhar o progresso, use: npm run kb:reindex status');
      break;
    }

    case 'status': {
      const jobs = listKnowledgeBackfillJobs();
      if (jobs.length === 0) {
        console.log('Nenhum job de reindexação encontrado.');
        break;
      }

      console.log(`\n=== Jobs de Reindexação (${jobs.length}) ===\n`);
      for (const job of jobs.sort((a, b) => b.startedAt.localeCompare(a.startedAt))) {
        console.log(`Job ID: ${job.id}`);
        console.log(`Status: ${job.status}`);
        console.log(`Iniciado: ${job.startedAt}`);
        if (job.finishedAt) console.log(`Finalizado: ${job.finishedAt}`);
        console.log(`Dry Run: ${job.dryRun ? 'Sim' : 'Não'}`);
        console.log(`Arquivos escaneados: ${job.scannedFiles}`);
        console.log(`Sucesso: ${job.successFiles}`);
        console.log(`Falha: ${job.failedFiles}`);
        console.log(`Textos vazios: ${job.emptyExtractedTextFiles}`);
        console.log(`Chunks gerados: ${job.totalChunksGenerated}`);
        if (job.error) console.log(`Erro: ${job.error}`);
        console.log('---');
      }
      break;
    }

    case 'list': {
      const files = await listKnowledgeFilesForBackfill({ includeInactive: false });
      console.log(`\n=== Arquivos para Reindexação (${files.length}) ===\n`);
      for (const file of files) {
        console.log(`ID: ${file.fileId} | Enterprise: ${file.enterpriseName} (${file.enterpriseId})`);
        console.log(`   Arquivo: ${file.originalName} | Ativo: ${file.isActive ? 'Sim' : 'Não'}`);
        console.log(`   Texto extraído: ${file.extractedText ? 'Sim' : 'Não'}`);
        console.log('---');
      }
      break;
    }

    case 'clean': {
      const jobs = listKnowledgeBackfillJobs();
      const completedJobs = jobs.filter(j => j.status === 'completed' || j.status === 'failed');
      let deleted = 0;
      
      for (const job of completedJobs) {
        if (deleteKnowledgeBackfillJob(job.id)) {
          deleted++;
        }
      }
      
      console.log(`Limpados ${deleted} jobs finalizados.`);
      break;
    }

    default:
      console.log('Uso:');
      console.log('  npm run kb:reindex start [--dry-run] [--enterprise ID] [--file ID] [--max N]');
      console.log('  npm run kb:reindex status');
      console.log('  npm run kb:reindex list');
      console.log('  npm run kb:reindex clean');
      break;
  }
}

main().catch(err => {
  console.error('Erro:', err);
  process.exit(1);
});
