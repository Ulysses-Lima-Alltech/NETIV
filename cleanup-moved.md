# Cleanup Moved (Quarentena)

Quarentena usada: `C:\Users\ulyss\Desktop\NETIV\LIXO`

## Arquivos movidos

| Arquivo | Origem | Destino | Motivo | Risco |
|---|---|---|---|---|
| `netiv.dump` | `C:\Users\ulyss\Desktop\NETIV\inbox-app\netiv.dump` | `C:\Users\ulyss\Desktop\NETIV\LIXO\netiv.dump` | Dump de banco (backup artefato) sem uso em runtime/build/test | baixo |
| `run-report-overrides.json` | `C:\Users\ulyss\Desktop\NETIV\inbox-app\run-report-overrides.json` | `C:\Users\ulyss\Desktop\NETIV\LIXO\run-report-overrides.json` | Override de relatório ad hoc (não integrado ao build) | baixo |
| `run-report-enterprise-overrides.json` | `C:\Users\ulyss\Desktop\NETIV\inbox-app\run-report-enterprise-overrides.json` | `C:\Users\ulyss\Desktop\NETIV\LIXO\run-report-enterprise-overrides.json` | Override de relatório ad hoc por empreendimento | baixo |
| `src/api/mockApi.ts` | `C:\Users\ulyss\Desktop\NETIV\inbox-app\src\api\mockApi.ts` | `C:\Users\ulyss\Desktop\NETIV\LIXO\src\api\mockApi.ts` | Mock API legado sem import de código | médio |
| `server/utils/commercialFlowState.selftest.ts` | `C:\Users\ulyss\Desktop\NETIV\inbox-app\server\utils\commercialFlowState.selftest.ts` | `C:\Users\ulyss\Desktop\NETIV\LIXO\server\utils\commercialFlowState.selftest.ts` | Self-test manual isolado | baixo |
| `server/scripts/anaCostReport.js` | `C:\Users\ulyss\Desktop\NETIV\inbox-app\server\scripts\anaCostReport.js` | `C:\Users\ulyss\Desktop\NETIV\LIXO\server\scripts\anaCostReport.js` | Script diagnóstico manual não integrado a npm scripts | médio |
| `server/scripts/reindexKnowledgeBackfill.ts` | `C:\Users\ulyss\Desktop\NETIV\inbox-app\server\scripts\reindexKnowledgeBackfill.ts` | `C:\Users\ulyss\Desktop\NETIV\LIXO\server\scripts\reindexKnowledgeBackfill.ts` | CLI manual não integrada (sem script npm) | médio |
| `docs/PARTE-1-ANALISE.md` | `C:\Users\ulyss\Desktop\NETIV\inbox-app\docs\PARTE-1-ANALISE.md` | `C:\Users\ulyss\Desktop\NETIV\LIXO\docs\PARTE-1-ANALISE.md` | Relatório histórico de análise | médio |
| `docs/MOTOR-IA-RELATORIO-FINAL.md` | `C:\Users\ulyss\Desktop\NETIV\inbox-app\docs\MOTOR-IA-RELATORIO-FINAL.md` | `C:\Users\ulyss\Desktop\NETIV\LIXO\docs\MOTOR-IA-RELATORIO-FINAL.md` | Relatório histórico de implementação | médio |
| `docs/LEAD-FUNNEL-REPORT.md` | `C:\Users\ulyss\Desktop\NETIV\inbox-app\docs\LEAD-FUNNEL-REPORT.md` | `C:\Users\ulyss\Desktop\NETIV\LIXO\docs\LEAD-FUNNEL-REPORT.md` | Relatório histórico do funil | médio |
| `server/docs/AGENTE_MODELAGEM.md` | `C:\Users\ulyss\Desktop\NETIV\inbox-app\server\docs\AGENTE_MODELAGEM.md` | `C:\Users\ulyss\Desktop\NETIV\LIXO\server\docs\AGENTE_MODELAGEM.md` | Documento técnico não referenciado no pipeline | médio |
| `.cursor/debug-7815f2.log` | `C:\Users\ulyss\Desktop\NETIV\inbox-app\.cursor\debug-7815f2.log` | `C:\Users\ulyss\Desktop\NETIV\LIXO\.cursor\debug-7815f2.log` | Log local de debug | baixo |

## Comando de restauração individual

Exemplo (substitua `<REL_PATH>`):

```powershell
Move-Item -LiteralPath "C:\Users\ulyss\Desktop\NETIV\LIXO\<REL_PATH>" -Destination "C:\Users\ulyss\Desktop\NETIV\inbox-app\<REL_PATH>" -Force
```

Exemplos prontos:

```powershell
Move-Item -LiteralPath "C:\Users\ulyss\Desktop\NETIV\LIXO\src\api\mockApi.ts" -Destination "C:\Users\ulyss\Desktop\NETIV\inbox-app\src\api\mockApi.ts" -Force
Move-Item -LiteralPath "C:\Users\ulyss\Desktop\NETIV\LIXO\server\utils\commercialFlowState.selftest.ts" -Destination "C:\Users\ulyss\Desktop\NETIV\inbox-app\server\utils\commercialFlowState.selftest.ts" -Force
```

## Comando de restauração em massa

```powershell
$root = "C:\Users\ulyss\Desktop\NETIV\inbox-app"
$trash = "C:\Users\ulyss\Desktop\NETIV\LIXO"
$files = @(
  "netiv.dump",
  "run-report-overrides.json",
  "run-report-enterprise-overrides.json",
  "src/api/mockApi.ts",
  "server/utils/commercialFlowState.selftest.ts",
  "server/scripts/anaCostReport.js",
  "server/scripts/reindexKnowledgeBackfill.ts",
  "docs/PARTE-1-ANALISE.md",
  "docs/MOTOR-IA-RELATORIO-FINAL.md",
  "docs/LEAD-FUNNEL-REPORT.md",
  "server/docs/AGENTE_MODELAGEM.md",
  ".cursor/debug-7815f2.log"
)

foreach ($rel in $files) {
  $src = Join-Path $trash $rel
  if (-not (Test-Path -LiteralPath $src)) { continue }
  $dst = Join-Path $root $rel
  New-Item -ItemType Directory -Path (Split-Path -Parent $dst) -Force | Out-Null
  Move-Item -LiteralPath $src -Destination $dst -Force
}
```

## Validações executadas após a movimentação

| Comando | Resultado | Observação |
|---|---|---|
| `npm run build` (raiz) | passou | build Vite/TS ok |
| `npx tsc -b` (raiz) | passou | typecheck ok |
| `npm run lint` (raiz) | falhou | falhas pré-existentes de lint em múltiplos arquivos (inclui `server/dist/*.d.ts`, rotas e páginas) |
| `cd server && npm run build` | passou | build server ok |
| `cd server && npm test` | falhou | 1 teste falhou: `anaMultiTopicCommercialReply.test` (assert de conteúdo `"corretor"`); sem erro de arquivo ausente |
| `cd server && npx tsc -b` | passou | typecheck server ok |

## Restaurações realizadas por falha

- Nenhuma restauração automática foi necessária.
- As falhas encontradas não indicaram dependência dos arquivos movidos (não houve `ENOENT`/import ausente).
