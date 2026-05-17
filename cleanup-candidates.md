# Cleanup Candidates (Pré-Movimentação)

Escopo de análise aplicado antes da triagem:

- Busca por imports/requires/referências diretas e por nome de arquivo/export com `rg`.
- Busca em `package.json`, `server/package.json`, `tsconfig*`, rotas e scripts de build.
- Verificação de padrões dinâmicos/autodiscovery:
  - `server/db/migrate.ts` usa `readdirSync` apenas em `server/db/migrations/pg`.
  - `server/scripts/copy-migrations.cjs` copia apenas `server/db/migrations/**/*.sql`.
  - Não há loader dinâmico para `docs/`, `run-report*.json`, `netiv.dump`, `src/api/mockApi.ts`, `server/utils/commercialFlowState.selftest.ts`.

## Candidatos de Risco Baixo/Médio (Movimentar para quarentena)

| Caminho original | Motivo técnico para mover | Evidência de não referência | Risco | Observação |
|---|---|---|---|---|
| `netiv.dump` | Dump de banco (artefato de backup), não faz parte de runtime/build/test | `rg -n "netiv.dump" .` sem matches fora do próprio arquivo | baixo | backup/dump |
| `run-report-overrides.json` | Arquivo de override pontual de execução (auditoria ad hoc) | `rg -n "run-report-overrides.json" .` sem matches | baixo | auditoria temporária |
| `run-report-enterprise-overrides.json` | Override pontual por empreendimento (auditoria ad hoc) | `rg -n "run-report-enterprise-overrides.json" .` sem matches | baixo | auditoria temporária |
| `src/api/mockApi.ts` | API mock legada; código frontend usa `src/api/client.ts` | `rg -n "mockApi" src server` sem imports; exports `listConversations/getMessages/sendMessage` só aparecem no próprio arquivo | médio | mock antigo / código morto |
| `server/utils/commercialFlowState.selftest.ts` | Self-test manual isolado (não integrado à suíte) | `rg -n "commercialFlowState.selftest" .` só retorna comentário no próprio arquivo; sem import em runtime/test scripts | baixo | diagnóstico/manual |
| `server/scripts/anaCostReport.js` | Script manual de relatório de custo, não ligado a scripts npm | `rg -n "anaCostReport" package.json server/package.json README.md docs` sem matches | médio | script temporário/diagnóstico |
| `server/scripts/reindexKnowledgeBackfill.ts` | CLI manual redundante com endpoints de reindex já ativos em `server/routes/knowledge.ts` | `rg -n "reindexKnowledgeBackfill|kb:reindex" package.json server/package.json README.md docs` sem matches fora do próprio arquivo | médio | utilitário manual não integrado |
| `docs/PARTE-1-ANALISE.md` | Relatório histórico de análise de implementação | Referenciado apenas por `docs/IMPLEMENTACAO-WHATSAPP-BASE.md` (documentação interna), sem impacto de runtime/build/test | médio | relatório/auditoria |
| `docs/MOTOR-IA-RELATORIO-FINAL.md` | Relatório histórico de entrega técnica | `rg -n "MOTOR-IA-RELATORIO-FINAL.md" .` sem matches | médio | relatório/auditoria |
| `docs/LEAD-FUNNEL-REPORT.md` | Relatório histórico de entrega do funil | Referência apenas documental (self/documentação), sem uso de runtime/build/test | médio | relatório/auditoria |
| `server/docs/AGENTE_MODELAGEM.md` | Documento técnico histórico, sem integração em build/runtime | `rg -n "AGENTE_MODELAGEM.md" .` sem matches | médio | documentação de modelagem |
| `.cursor/debug-7815f2.log` | Log local de debug (não versionado, não produtivo) | Arquivo local de editor; sem import/uso por projeto | baixo | debug/log local |

## CANDIDATOS DE ALTO RISCO - NÃO MOVIDOS

| Caminho original | Motivo para não mover agora | Evidência/risco |
|---|---|---|
| `server/scripts/addLlmCostBackfill.js` | Referenciado por teste automatizado | `server/tests/llmUsageTracking.test.ts:259` faz `readFileSync('scripts/addLlmCostBackfill.js')` |
| `server/scripts/seed-admin.ts` | Script manual de recuperação/provisionamento de ADMIN (operação) | Sem referência automática, mas impacto operacional alto em recuperação de acesso |
| `start.bat` | Atalho operacional de desenvolvimento local | Sem referência em código, porém utilitário explícito de execução local |
| `docs/IMPLEMENTACAO-WHATSAPP-BASE.md` | Documento base que referencia outros docs históricos | Pode ser necessário para trilha de implementação e suporte |
| `INTEGRACAO-WHATSAPP.md` | Documento de integração operacional | Risco de perda de contexto de operação/configuração |
| `network-config.json` | Configuração de infraestrutura/rede | Arquivo de deploy/infra; regra explícita para preservar configs de deploy |
