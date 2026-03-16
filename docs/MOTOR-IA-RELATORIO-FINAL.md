# Motor de IA — Relatório final

## Arquivos criados

| Arquivo | Finalidade |
|---------|------------|
| `server/db/migrations/007_openai_settings.sql` | Colunas OpenAI na tabela integration_settings (openai_api_key, openai_base_url, model_cold_lead, model_hot_lead, temperature, max_tokens, lead_score_threshold, ai_enabled) |
| `server/types/ai.ts` | Tipos OpenAIConfig, OpenAIConfigPublic, OpenAIConfigUpdate |
| `server/repositories/openaiConfigRepository.ts` | getOpenAIConfig(), updateOpenAIConfig(), getOpenAIConfigPublic() — leitura/gravação na mesma linha id=1 |
| `server/validators/ai.ts` | Schema Zod openAISettingUpdateSchema para PUT /api/settings/ai |
| `server/routes/settingsAi.ts` | GET /ai e PUT /ai (montado em /settings) |
| `server/services/openaiService.ts` | generateChatCompletion() — fetch para OpenAI Chat Completions com timeout |
| `server/services/promptBuilder.ts` | buildPrompt() — system + últimas 10 mensagens + userMessage |
| `server/services/leadScoring.ts` | detectLeadScore() — palavras quente (preço, orçamento, etc.) → score 0–1 |
| `server/services/messageRouter.ts` | routeAndGenerate() — lead score vs threshold → model cold/hot → openaiService |
| `server/services/conversationEngine.ts` | handleIncomingMessage() — histórico, prompt, roteador, envio WhatsApp, persistência |

## Arquivos alterados

| Arquivo | Alteração |
|---------|------------|
| `server/db/index.ts` | Inclusão da migration 007_openai_settings.sql |
| `server/routes/index.ts` | router.use('/settings', settingsAiRouter) para GET/PUT /api/settings/ai |
| `server/services/webhookProcessor.ts` | Após inserir mensagem inbound, se ai_enabled chama handleIncomingMessage em setImmediate (não bloqueia resposta) |
| `server/types/whatsapp.ts` | Correção de typo: `Array<{ id: string };` → `Array<{ id: string }>` |
| `server/routes/settings.ts` | Uso de parsed.error.issues (Zod) |
| `server/routes/settingsAi.ts` | Uso de parsed.error.issues |
| `server/routes/whatsapp.ts` | Uso de parsed.error.issues |
| `src/api/client.ts` | Interfaces AIConfigPublic, AIConfigUpdate; settingsApi.getAI(), settingsApi.putAI() |
| `src/pages/SettingsWhatsAppPage.tsx` | Seção "Inteligência Artificial": estado aiConfig/aiForm, load GET /settings/ai, formulário (API Key mostrar/ocultar, modelos, temperature, max tokens, threshold, toggle IA ativa), submit PUT /settings/ai |

## Migrations

| Nome | Conteúdo |
|------|----------|
| `007_openai_settings.sql` | ALTER TABLE integration_settings ADD COLUMN para openai_api_key, openai_base_url, model_cold_lead, model_hot_lead, temperature, max_tokens, lead_score_threshold, ai_enabled; UPDATE com valores padrão na linha id=1 |

## Rotas novas

| Método | Caminho | Finalidade |
|--------|---------|------------|
| GET | /api/settings/ai | Retorna configuração de IA (API key mascarada) |
| PUT | /api/settings/ai | Atualiza configuração de IA (Zod); nunca retorna openaiApiKey |

## Services novos

| Service | Responsabilidade |
|--------|------------------|
| openaiService | generateChatCompletion — chamada HTTP à API OpenAI (Chat Completions), timeout, tratamento de erro |
| promptBuilder | buildPrompt — system fixo + últimas 10 mensagens do histórico + mensagem do usuário |
| leadScoring | detectLeadScore — análise de palavras (preço, valor, comprar, orçamento, etc.) → score 0–1 |
| messageRouter | routeAndGenerate — obtém config, calcula lead score, escolhe model cold/hot conforme threshold, chama openaiService |
| conversationEngine | handleIncomingMessage — busca histórico, monta prompt, roteador, envia resposta via whatsappMetaService e persiste mensagem outbound |

## Como configurar a OpenAI

1. Acesse **Configurações** (link no topo do Inbox ou `/settings/integrations/whatsapp`).
2. Role até a seção **Inteligência Artificial**.
3. Preencha:
   - **OpenAI API Key**: chave da API (mostrar/ocultar; deixe em branco para manter a atual).
   - **Base URL** (opcional): ex. `https://api.openai.com/v1` (padrão usado se vazio).
   - **Modelo conversa inicial (cold lead)**: ex. `gpt-4`.
   - **Modelo lead quente (hot lead)**: ex. `gpt-4o`.
   - **Temperature**: 0–2 (ex.: 0.4).
   - **Max tokens**: ex. 500.
   - **Lead score threshold**: 0–1 (ex.: 0.75) — acima disso usa modelo hot.
4. Ative **IA ativa** e clique em **Salvar IA**.

A API key não é exibida na resposta; o front só indica se está preenchida (mascarada).

## Como testar a resposta automática

1. **Configuração**: WhatsApp configurado e ativo; OpenAI configurada e **IA ativa** ligada.
2. **Webhook**: Meta apontando para `https://<seu-dominio>/api/webhook/whatsapp` (ou `/api/webhooks/whatsapp`).
3. **Fluxo**:
   - Cliente envia uma mensagem no WhatsApp.
   - O webhook recebe o POST, persiste a mensagem inbound e, se `ai_enabled`, agenda `handleIncomingMessage` (setImmediate).
   - O motor busca o histórico da conversa, monta o prompt, calcula o lead score, escolhe o modelo (cold/hot), chama a OpenAI, envia a resposta pelo WhatsApp e grava a mensagem outbound.
4. **Verificação**: conferir no app que a resposta automática foi enviada e que a mensagem outbound aparece no histórico (ex.: tela de teste de conversa).

## Segurança

- **openaiApiKey** nunca é retornada pela API; apenas indicador de “preenchida” (mascarada).
- Logs não incluem a chave (apenas mensagens genéricas de erro).
- Frontend nunca chama a OpenAI diretamente; todas as chamadas passam pelo backend.

## Estrutura final de services

```
server/services/
  whatsappMetaService.ts   # Envio WhatsApp + testConnection
  webhookProcessor.ts      # Verificação + processamento webhook + disparo assíncrono da IA
  openaiService.ts         # generateChatCompletion
  promptBuilder.ts         # buildPrompt
  leadScoring.ts           # detectLeadScore
  messageRouter.ts         # routeAndGenerate (escolha de modelo + OpenAI)
  conversationEngine.ts    # handleIncomingMessage (orquestração completa)
```
