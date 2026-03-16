# Implementação técnica completa — Base de integração WhatsApp

## Parte 12 — Estrutura de arquivos

### ARQUIVOS CRIADOS

| Caminho | Finalidade |
|--------|------------|
| `docs/PARTE-1-ANALISE.md` | Análise da estrutura atual do projeto e padrões adotados |
| `server/lib/maskToken.ts` | Utilitário para mascarar token em logs/respostas |
| `server/validators/settings.ts` | Schema Zod para atualização de configuração WhatsApp |
| `server/validators/whatsapp.ts` | Schema Zod para envio de mensagem (to, message) |
| `server/db/migrations/005_integration_settings_extra.sql` | Colunas provider, default_country_code, created_at em integration_settings |
| `server/db/migrations/006_conversations_messages_extra.sql` | Coluna last_message_at em conversations; type, content, error_message, sent_at, delivered_at, read_at, updated_at em messages |
| `src/pages/WhatsAppTestPage.tsx` | Tela de teste: lista de conversas, mensagens e envio |

### ARQUIVOS ALTERADOS

| Caminho | Alteração |
|--------|------------|
| `server/db/index.ts` | Inclusão das migrations 005 e 006; tratamento de "duplicate column" para idempotência |
| `server/types/settings.ts` | Campos defaultCountryCode, createdAt em configs; defaultCountryCode em update |
| `server/types/webhook.ts` | Status 'failed' em WebhookStatus |
| `server/repositories/whatsappConfigRepository.ts` | Leitura/gravação de default_country_code e created_at; validação validateConfigForEnabled |
| `server/repositories/conversationRepository.ts` | Campo last_message_at; listConversations(); atualização de last_message_at no update |
| `server/repositories/messageRepository.ts` | Campos type, content; insert com type/content; updateMessageStatusByExternalId |
| `server/services/whatsappMetaService.ts` | testConnection() — GET do número na Meta para validar token e Phone Number ID |
| `server/services/webhookProcessor.ts` | verifyWebhook(); processamento de statuses e errors; atualização de mensagens outbound |
| `server/routes/settings.ts` | Zod no PUT; defaultCountryCode; validateConfigForEnabled; POST /whatsapp/test |
| `server/routes/whatsapp.ts` | Zod no POST /send; GET /conversations; GET /conversations/:id/messages |
| `server/routes/webhook.ts` | Uso de verifyWebhook() no GET |
| `server/routes/index.ts` | Rota /webhooks/whatsapp (alias do webhook) |
| `src/api/client.ts` | Tipos ConversationListItem, MessageListItem; defaultCountryCode; settingsApi.testWhatsApp(); whatsappApi.getConversations, getConversationMessages |
| `src/pages/SettingsWhatsAppPage.tsx` | Campo defaultCountryCode; teste de conexão via settingsApi.testWhatsApp() |
| `src/App.tsx` | Rota /enviar-whatsapp → WhatsAppTestPage; rota /whatsapp-enviar → SendWhatsAppPage |

### MIGRATIONS

| Nome | O que mudou |
|------|--------------|
| `005_integration_settings_extra.sql` | integration_settings: ADD COLUMN provider, default_country_code, created_at; UPDATE para preencher provider |
| `006_conversations_messages_extra.sql` | conversations: ADD COLUMN last_message_at; messages: ADD COLUMN type, content, error_message, sent_at, delivered_at, read_at, updated_at; UPDATE para preencher content a partir de body_text |

### ROTAS NOVAS / ALTERADAS

| Método | Caminho | Finalidade |
|--------|--------|------------|
| GET | /api/settings/integrations/whatsapp | Retorna configuração (token/verify token mascarados) |
| PUT | /api/settings/integrations/whatsapp | Cria/atualiza configuração; validação quando enabled=true |
| POST | /api/settings/integrations/whatsapp/test | Testa conexão com a Meta (GET do phone number) |
| POST | /api/whatsapp/send | Envia mensagem de texto (body: to, message) |
| GET | /api/whatsapp/config/check | Verifica se token e Phone Number ID estão configurados |
| GET | /api/whatsapp/conversations | Lista conversas (query: channel, limit) |
| GET | /api/whatsapp/conversations/:id/messages | Lista mensagens da conversa |
| GET | /api/webhook/whatsapp | Verificação do webhook (hub.mode, hub.verify_token, hub.challenge) |
| GET | /api/webhooks/whatsapp | Alias do mesmo webhook |
| POST | /api/webhook/whatsapp | Recebe eventos da Meta |
| POST | /api/webhooks/whatsapp | Alias do mesmo webhook |

### MODELS / TABELAS

| Nome | Finalidade |
|------|------------|
| integration_settings | Uma configuração por integração (provider/integration_type); credenciais Meta, webhook, enabled, default_country_code, created_at, updated_at |
| conversations | Uma linha por contato/canal (channel + external_id); contact_phone, contact_name, status, last_message_at |
| messages | Mensagens por conversa; direction (inbound/outbound), type, content, status, externalMessageId (meta_message_id), timestamps e error_message |
| webhook_events | Log de eventos do webhook (meta_message_id, event_type, payload, processed) |

### COMPONENTES / PÁGINAS NOVAS

| Nome | Finalidade |
|------|------------|
| WhatsAppTestPage | Tela de teste: lista de conversas (GET /whatsapp/conversations), mensagens ao selecionar (GET /conversations/:id/messages), envio (POST /send) e feedback de status |

### SERVICES NOVOS / ALTERADOS

| Nome | Responsabilidade |
|------|------------------|
| whatsappMetaService.sendTextMessage | Envio de texto à Meta; uso da config salva; timeout e tratamento de erro |
| whatsappMetaService.testConnection | GET do phone number na Meta para validar token e Phone Number ID |
| webhookProcessor.verifyWebhook | Valida mode, token e challenge; retorna challenge se válido |
| webhookProcessor.processIncomingWebhook | Processa payload; persiste mensagens inbound; processa statuses e errors e atualiza mensagens outbound |

---

## Parte 13 — Resultado final

### 1. Como ficou a arquitetura

- **Backend**: Express sob `/api`; rotas por domínio (settings, whatsapp, webhook); repositórios com SQLite (better-sqlite3); serviços para Meta e webhook; validação com Zod nos payloads; token nunca exposto nas respostas.
- **Frontend**: React com rotas para Inbox, Configurações WhatsApp, Teste WhatsApp e envio simples; cliente API em `src/api/client.ts`; configuração e teste de conexão via backend.
- **Persistência**: integration_settings (uma linha por integração), conversations (canal + contato), messages (inbound/outbound, status, externalMessageId), webhook_events (log).
- **Webhook**: GET para verificação (verifyWebhook); POST para eventos (processIncomingWebhook: mensagens, statuses, errors); persistência e atualização de status de mensagens.

### 2. Como preencher a configuração do WhatsApp

1. Acesse **Configurações** (ou `/settings/integrations/whatsapp`).
2. Preencha: **Token da Meta**, **Phone Number ID**, **Business Account ID** (opcional), **Versão da API**, **Verify Token** (webhook), **Número padrão** e **Código do país** (opcionais).
3. Marque **Integração ativa** e clique em **Salvar**. Se faltar token, Phone Number ID, API version ou Verify Token, a API retorna erro e a integração é salva como inativa.
4. Use **Testar conexão** para validar token e Phone Number ID com a Meta (GET do número).

### 3. Como testar envio manual

1. **Tela de teste** (Enviar WhatsApp / `/enviar-whatsapp`): lista de conversas à esquerda; ao clicar, carrega mensagens e o número fica fixo; em baixo, digite a mensagem e **Enviar**. Sem conversa selecionada, informe o número no campo e a mensagem.
2. **Envio simples** (`/whatsapp-enviar`): apenas número, mensagem e botão Enviar.
3. Todas as chamadas passam pelo backend (POST /api/whatsapp/send); o front nunca usa o token.

### 4. Como configurar / verificar o webhook na Meta

1. No app Meta (WhatsApp > Configuração), em **Webhook**, informe:
   - **URL**: `https://<seu-dominio>/api/webhook/whatsapp` ou `/api/webhooks/whatsapp`.
   - **Token de verificação**: o mesmo **Verify Token** da tela de configurações.
2. A Meta envia GET com `hub.mode=subscribe`, `hub.verify_token`, `hub.challenge`. O backend valida o token e responde com o `challenge`.
3. Inscreva-se em **messages**. Os POSTs serão recebidos no mesmo path; o backend persiste mensagens e atualiza status (sent, delivered, read, failed).

### 5. Endpoints existentes

- **Settings**: GET/PUT `/api/settings/integrations/whatsapp`, POST `/api/settings/integrations/whatsapp/test`.
- **WhatsApp**: POST `/api/whatsapp/send`, GET `/api/whatsapp/config/check`, GET `/api/whatsapp/conversations`, GET `/api/whatsapp/conversations/:id/messages`.
- **Webhook**: GET e POST `/api/webhook/whatsapp` e `/api/webhooks/whatsapp`.

### 6. Próximos passos facilitados por essa base

- **GPT/agente**: mesma tela de configurações pode ganhar seções (provider, model, prompt, temperatura, regras) sem mudar a estrutura de settings.
- **Autenticação**: rotas de settings e whatsapp podem ser protegidas por middleware de auth/admin.
- **Templates e mídia**: `whatsappMetaService` pode ganhar sendTemplate, sendMedia, etc., reutilizando a mesma config.
- **Regras/IA**: webhook já persiste eventos e mensagens; um job ou handler pode consumir fila/eventos e aplicar regras ou chamar GPT.
- **Paginação**: GET conversations já aceita `limit`; pode ser estendido com `offset` ou cursor.

---

## Segurança e segredos

- Token e Verify Token ficam apenas no backend (integration_settings); o front nunca os recebe completos (apenas indicador de “preenchido”).
- Nenhum segredo hardcoded; credenciais vêm do banco (configuração salva na tela).
- Logs e respostas usam máscara para não vazar token.
- Variáveis de ambiente (PORT, DB_PATH, etc.) continuam em `server/.env` conforme `server/.env.example`.
