# Relatório final — Sistema de Classificação de Leads e Funil Comercial

## Arquivos criados

| Arquivo | Descrição |
|---------|-----------|
| `server/db/migrations/008_lead_funnel.sql` | Migration: colunas de lead em `conversations` e índice em `lead_stage`. |
| `server/services/leadAnalyzer.ts` | Serviço: `analyzeLead(conversationId)`, `computeLeadAnalysis(messages)`, heurísticas de score/estágio/intenção. |
| `server/routes/lead.ts` | Rota POST /api/lead/analyze com validação Zod. |
| `src/pages/LeadSimulatorPage.tsx` | Página do simulador de leads (textarea + botão Analisar Lead + exibição do resultado). |
| `docs/LEAD-FUNNEL-SYSTEM.md` | Documentação do funil, score, estágio, simulador e integração com IA. |
| `docs/LEAD-FUNNEL-REPORT.md` | Este relatório. |

## Arquivos alterados

| Arquivo | Alterações |
|---------|------------|
| `server/db/index.ts` | Inclusão da migration `008_lead_funnel.sql` na lista de migrations. |
| `server/repositories/conversationRepository.ts` | Interface `ConversationRow` com `lead_stage`, `lead_score`, `lead_intent_now`, `lead_reason`, `lead_last_analyzed_at`; SELECT em `findOrCreateConversation` atualizado para essas colunas. |
| `server/services/conversationEngine.ts` | Import de `analyzeLead` e `getConversationById`; após validar IA ativa, chama `analyzeLead(conversationId)`, obtém `lead_stage` da conversa e passa para `routeAndGenerate(..., leadStage)`. |
| `server/services/messageRouter.ts` | Parâmetro opcional `leadStage?: LeadStage` em `routeAndGenerate`; escolha de modelo: HOT → `model_hot_lead`, COLD/WARM → `model_cold_lead`; fallback por `leadScore` vs `leadScoreThreshold` quando `leadStage` não informado. |
| `server/routes/index.ts` | Registro de `leadRouter` em `router.use('/lead', leadRouter)`. |
| `src/api/client.ts` | Interface `LeadAnalysisResponse` e `leadApi.analyze(messages)`. |
| `src/App.tsx` | Import de `LeadSimulatorPage` e rota `/lead-simulator` apontando para ela. |

## Migrations

- **008_lead_funnel.sql**: adiciona em `conversations` as colunas `lead_stage`, `lead_score`, `lead_intent_now`, `lead_reason`, `lead_last_analyzed_at` e o índice `idx_conversations_lead_stage`.

## Rotas novas

- **POST /api/lead/analyze**  
  - Body: `{ messages: string[] }`  
  - Resposta: `{ leadScore, leadStage, leadIntentNow, reason }`  
  - Não utiliza OpenAI; apenas heurísticas.

## Services novos / alterados

- **leadAnalyzer.ts** (novo):  
  - `analyzeLead(conversationId)`: busca últimas 20 mensagens inbound, chama `computeLeadAnalysis`, persiste resultado na conversa.  
  - `computeLeadAnalysis(messages: string[])`: lógica pura de score, estágio e intenção; exportada para uso no endpoint e em testes.
- **conversationEngine.ts**: integração com `analyzeLead` e repasse de `lead_stage` para o roteador.
- **messageRouter.ts**: uso de `lead_stage` para escolher modelo (COLD/WARM → cold, HOT → hot).

## Componentes React

- **LeadSimulatorPage** (`src/pages/LeadSimulatorPage.tsx`): tela em `/lead-simulator` com textarea para simular mensagens (uma por linha), botão "Analisar Lead" e exibição de Lead Score, Lead Stage, Intent Now e Motivo.

## Resumo

- Funil COLD / WARM / HOT implementado com heurísticas determinísticas.
- Banco atualizado via migration 008; repositório e tipos ajustados.
- Análise de lead roda após cada mensagem inbound e orienta a escolha do modelo de IA.
- Simulador e endpoint de teste permitem validar a classificação sem OpenAI.
- Documentação em `docs/LEAD-FUNNEL-SYSTEM.md`.
- Integração WhatsApp, webhook e motor de IA existentes preservados.
