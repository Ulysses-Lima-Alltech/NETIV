# Integração WhatsApp Business Cloud API (Meta)

## Resumo da implementação

- **Backend**: Express (TypeScript) em `server/`, com SQLite para configurações, conversas e mensagens.
- **Frontend**: Telas em React (Configurações > Integrações > WhatsApp e Enviar WhatsApp), sem token no cliente.
- **Webhook**: Rotas para verificação (GET) e recebimento de eventos (POST); eventos são logados e mensagens persistidas.

---

## Arquivos criados

### Backend (`server/`)

| Arquivo | Descrição |
|--------|------------|
| `package.json` | Dependências e scripts do servidor |
| `tsconfig.json` | TypeScript do servidor |
| `config.ts` | PORT, DB_PATH, META_API_VERSION |
| `index.ts` | Entrada Express, CORS, montagem de rotas |
| `types/settings.ts` | Tipos da configuração WhatsApp |
| `types/whatsapp.ts` | Tipos envio/resposta Meta |
| `types/webhook.ts` | Tipos do payload do webhook |
| `db/index.ts` | Conexão SQLite e execução de migrations |
| `db/migrations/001_integration_settings.sql` | Tabela de configurações da integração |
| `db/migrations/002_conversations.sql` | Tabela de conversas (canal, contato) |
| `db/migrations/003_messages.sql` | Tabela de mensagens (inbound/outbound) |
| `db/migrations/004_webhook_events.sql` | Log de eventos do webhook |
| `repositories/whatsappConfigRepository.ts` | Leitura/gravação da config WhatsApp |
| `repositories/conversationRepository.ts` | Buscar/criar conversa |
| `repositories/messageRepository.ts` | Inserir/buscar mensagens |
| `repositories/webhookEventRepository.ts` | Log de eventos webhook |
| `services/whatsappMetaService.ts` | Envio de texto via Graph API |
| `services/webhookProcessor.ts` | Processar payload e persistir mensagens recebidas |
| `routes/settings.ts` | GET/PUT configuração WhatsApp |
| `routes/whatsapp.ts` | POST send + GET config/check |
| `routes/webhook.ts` | GET (verificação) e POST (eventos) |
| `routes/index.ts` | Agregador de rotas |
| `.env.example` | Exemplo de variáveis de ambiente |

### Frontend (`src/`)

| Arquivo | Descrição |
|--------|------------|
| `api/client.ts` | Cliente HTTP para `/api` (settings, whatsapp send/check) |
| `pages/SettingsWhatsAppPage.tsx` | Tela Configurações > Integrações > WhatsApp |

### Alterados

| Arquivo | Alteração |
|--------|------------|
| `vite.config.ts` | Proxy `/api` e `/webhook` para `http://localhost:3001` |
| `App.tsx` | Rotas: Inbox, Agenda, Empreendimentos, Corretores, Configurações WhatsApp |
| `package.json` (raiz) | Scripts `dev:server`, `dev:all` e dependência `concurrently` |
| `src/pages/InboxPage.tsx` | Links de navegação; fluxo "+ Nova" para enviar mensagens |
| `.gitignore` | `server/data`, `.env` |

---

## Variáveis de ambiente (servidor)

Opcionais; valores padrão em `server/config.ts`:

| Variável | Padrão | Uso |
|----------|--------|-----|
| `PORT` | 3001 | Porta do servidor |
| `NODE_ENV` | development | Ambiente |
| `DB_PATH` | ./data/inbox.db | Caminho do SQLite (relativo ao `server/`) |
| `META_API_VERSION` | v21.0 | Versão da Graph API |

Copie `server/.env.example` para `server/.env` e ajuste se precisar.

---

## Rotas da API (backend)

Todas sob o prefixo `/api` quando atrás do proxy do Vite.

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/settings/integrations/whatsapp` | Retorna configuração (token e verify token mascarados) |
| PUT | `/api/settings/integrations/whatsapp` | Atualiza configuração WhatsApp |
| POST | `/api/whatsapp/send` | Envia mensagem de texto (body: `{ to, message }`) |
| GET | `/api/whatsapp/config/check` | Verifica se token e Phone Number ID estão configurados |
| GET | `/api/webhook/whatsapp` | Verificação do webhook (Meta: `hub.mode`, `hub.verify_token`, `hub.challenge`) |
| POST | `/api/webhook/whatsapp` | Recebimento de eventos/mensagens do Meta |

---

## Como usar

### 1. Subir o projeto

```bash
# Na raiz do projeto
npm install
npm run dev:all
```

Ou em dois terminais:

```bash
# Terminal 1 – backend
cd server && npm install && npm run dev

# Terminal 2 – frontend
npm run dev
```

- Frontend: http://localhost:5173 (ou outra porta que o Vite informar)
- Backend: http://localhost:3001

### 2. Configurar a integração WhatsApp

1. Acesse **Configurações** (link no topo do Inbox) ou `/settings/integrations/whatsapp`.
2. Preencha:
   - **Token de acesso (Meta)**: token permanente da Meta (nunca no front).
   - **Phone Number ID**: ID do número de telefone no Meta Business.
   - **Business Account ID**: opcional.
   - **Versão da API**: ex.: `v21.0`.
   - **Verify Token (webhook)**: valor que você escolher para a verificação do webhook.
   - **Número padrão de envio**: opcional.
   - **Integração ativa**: marque para habilitar.
3. Clique em **Salvar**.
4. Use **Testar conexão** para validar se token e Phone Number ID estão ok.

### 3. Testar envio de mensagem

1. Acesse o fluxo **"+ Nova"** no Inbox (botão na lista de conversas).
2. Informe o **número do destinatário** (ex.: `5511999999999`, com DDI, sem + ou espaços).
3. Digite a **mensagem** (opcional; padrão "Olá!") e clique em **Iniciar conversa**.
4. O backend usa a configuração salva e chama a Meta; o resultado aparece na própria tela.

### 4. Configurar o webhook na Meta

1. No [Meta for Developers](https://developers.facebook.com/), no app WhatsApp > Configuração do WhatsApp.
2. Em **Webhook**, clique em **Configurar**.
3. **URL de callback**:  
   - Desenvolvimento local: use um túnel (ex.: ngrok) apontando para `http://localhost:3001/api/webhook/whatsapp`.  
   - Produção: `https://<seu-dominio>/api/webhook/whatsapp`.
4. **Token de verificação**: o mesmo valor que você cadastrou na tela de configurações (campo **Verify Token (webhook)**).
5. Salve. A Meta fará um GET com `hub.mode=subscribe`, `hub.verify_token` e `hub.challenge`; o backend responde com o `challenge` para validar.
6. Inscreva-se nos eventos desejados (ex.: **messages**).

Após isso, mensagens recebidas serão enviadas pela Meta via POST para `/api/webhook/whatsapp`. O backend:

- Registra o evento em `webhook_events`;
- Cria ou atualiza a conversa e insere a mensagem em `messages` (inbound);
- Responde 200 OK para a Meta.

---

## Migrações

As migrations estão em `server/db/migrations/` e são executadas na primeira vez que o servidor acessa o banco (ao atender a primeira requisição que usa `getDb()`). Não é necessário rodar comando manual para criar as tabelas.

---

## Segurança

- O token da Meta **não** é exposto no frontend; todas as chamadas à API passam pelo backend.
- Na resposta de GET da configuração, token e verify token vêm mascarados (apenas indicação de que estão preenchidos).
- Logs no backend evitam imprimir o token completo.

---

## Próximos passos (sugestão)

- Endpoints para listar conversas e mensagens (ex.: `GET /api/conversations`, `GET /api/conversations/:id/messages`) para histórico na UI.
- Autenticação/admin e restringir a tela de configurações.
- Envio de templates e mídia (estrutura do `whatsappMetaService` já permite expansão).
- Regras/IA sobre eventos e mensagens persistidas (webhook desacoplado do processamento).
