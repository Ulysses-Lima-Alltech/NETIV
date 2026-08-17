# Inbox / Chat — Agente de Vendas

Front-end em React + TypeScript (Vite) com layout tipo Inbox/Chat: lista de conversas à esquerda e área de mensagens ao centro.

## Como rodar

```bash
npm install
cd server && npm install && cd ..
npm run dev:server   # backend em http://localhost:3001
npm run dev         # frontend (outro terminal)
```

Acesse [http://localhost:5173](http://localhost:5173). Rota principal: `/inbox`.

## Integração OpenAI (backend)

As rotas de IA usam variáveis de ambiente. **A chave da API fica somente no backend** e nunca é exposta ao frontend.

### Variáveis de ambiente

Crie `server/.env` (copie de `server/.env.example`):

- **OPENAI_API_KEY** (obrigatória): chave da API OpenAI
- **OPENAI_BASE_URL** (opcional): padrão `https://api.openai.com/v1`
- **OPENAI_MODEL** (opcional): padrão `gpt-4.1-mini`

Exemplo `server/.env`:

```env
OPENAI_API_KEY=sk-proj-...
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4.1-mini
```

### Instalar dependências do servidor

```bash
cd server
npm install
```

### Rodar o servidor

```bash
cd server
npm run dev
```

O servidor carrega o `.env` da pasta `server/`.

### Testar as rotas de IA

**POST /api/openai/test**

```bash
curl -X POST http://localhost:3001/api/openai/test -H "Content-Type: application/json" -d "{\"message\": \"Explique o que é automação\"}"
```

Resposta sucesso: `{ "ok": true, "response": "..." }`. Erro: `{ "ok": false, "error": "mensagem" }`.

**POST /api/ai/chat** (message obrigatória, systemPrompt opcional)

```bash
curl -X POST http://localhost:3001/api/ai/chat -H "Content-Type: application/json" -d "{\"message\": \"Olá\", \"systemPrompt\": \"Você é um assistente.\"}"
```

Resposta: `{ "ok": true, "response": "..." }` ou `{ "ok": false, "error": "..." }`.

**Importante:** a OPENAI_API_KEY deve existir apenas no backend (arquivo `.env` do servidor). Nunca envie a chave para o frontend.

## Webhook Meta + OpenAI

O backend expõe **GET** e **POST** em `/webhook` para o webhook da Meta (WhatsApp). Ao receber uma mensagem de texto, o servidor chama a OpenAI e responde ao usuário pelo WhatsApp Cloud API. Toda a integração fica no backend; segredos (OPENAI_API_KEY, META_WHATSAPP_TOKEN) não são expostos ao frontend nem logados.

### 1. Variáveis de ambiente necessárias

No `server/.env` (ou nas variáveis de ambiente da task definition do ECS):

| Variável | Obrigatória | Descrição |
|----------|-------------|-----------|
| `OPENAI_API_KEY` | Sim | Chave da API OpenAI |
| `OPENAI_BASE_URL` | Não | Padrão: `https://api.openai.com/v1` |
| `OPENAI_MODEL` | Não | Padrão: `gpt-4.1-mini` |
| `META_VERIFY_TOKEN` | Sim (para GET) | Token que você define; deve ser o mesmo cadastrado no painel da Meta |
| `META_WHATSAPP_TOKEN` | Sim | Token do WhatsApp Business (Meta) |
| `META_PHONE_NUMBER_ID` | Sim | Phone Number ID do número de teste/produção |
| `META_API_VERSION` | Não | Padrão: `v23.0` |

### 2. Como rodar localmente

```bash
cd server
npm install
cp .env.example .env   # edite .env e preencha as chaves
npm run dev
```

O servidor sobe em `http://localhost:3001`. Para a Meta validar o webhook, use um túnel (ngrok, Cloudflare Tunnel, etc.) apontando para `http://localhost:3001/webhook`.

### 3. Deploy na AWS (ECS/Fargate)

O backend roda como serviço ECS Fargate (cluster `Netiv`, serviço `netiv-backend-svc`), com imagem publicada no ECR (`netiv-backend`). Fluxo de deploy:

1. **Build da imagem:** `docker build -f server/Dockerfile -t netiv-backend:<tag> .` (build context é a raiz do repo — o Dockerfile copia `server/` e `public/data`).
2. **Push pro ECR:** autenticar (`aws ecr get-login-password | docker login ...`) e enviar a imagem com uma tag identificável (ex.: `<branch>-<sha>-<timestamp>`).
3. **Nova revisão da task definition:** registrar uma nova revisão de `netiv-backend` apontando pra imagem nova (`aws ecs register-task-definition`), preservando as variáveis de ambiente já configuradas.
4. **Atualizar o serviço:** `aws ecs update-service --cluster Netiv --service netiv-backend-svc --task-definition netiv-backend:<revisão> --force-new-deployment`.
5. O servidor lê `PORT` do ambiente (task definition já define `PORT=3000`).

O frontend (Amplify, app `dpul1nw36jf3m`) é redeployado separadamente via `aws amplify start-job --app-id dpul1nw36jf3m --branch-name main --job-type RELEASE`.

Em produção, a URL base do backend depende do host (AWS/CloudFront/ALB); o path do webhook no servidor é **`/webhook`** (ver `server/index.ts`).

### 4. URL para cadastrar no painel da Meta

**Callback URL (exemplo — ambiente AWS/CloudFront validado):**

```
https://d1mkg8ru36z4vf.cloudfront.net/webhook
```

Substitua pelo host público real do seu backend se for outro; o importante é que a URL termine no path **`/webhook`**. Cadastre em: Meta for Developers → Seu app → WhatsApp → Configuração → Webhook.

### 5. Verify Token

No painel da Meta, no campo **Verify token**, coloque o **mesmo valor** que você definiu em `META_VERIFY_TOKEN` no `.env`. Por exemplo, se no `.env` estiver:

```env
META_VERIFY_TOKEN=meu_token_secreto_123
```

então no painel da Meta use `meu_token_secreto_123`. A Meta envia esse valor em `hub.verify_token` no GET; o endpoint **`GET /webhook`** (`webhookMeta.ts`) usa primeiro o token salvo em **integrações** (`webhook_verify_token` no banco), e se estiver vazio cai no `META_VERIFY_TOKEN` do ambiente (`config.meta.verifyToken`).

### 6. Campo do webhook a assinar

No painel da Meta, em **Webhook fields**, marque (assine) o campo **messages**. Assim o POST `/webhook` receberá apenas eventos de mensagens.

### 7. Testar o GET /webhook

```bash
curl "http://localhost:3001/webhook?hub.mode=subscribe&hub.verify_token=MEU_TOKEN&hub.challenge=12345"
```

Se `MEU_TOKEN` for igual ao `META_VERIFY_TOKEN` do `.env`, a resposta deve ser `200` com corpo `12345`. Caso contrário, `403`.

### 8. Testar o POST /webhook localmente

Enviar um payload simulado (após o servidor estar no ar):

```bash
curl -X POST http://localhost:3001/webhook \
  -H "Content-Type: application/json" \
  -d '{"object":"whatsapp_business_account","entry":[{"changes":[{"field":"messages","value":{"messages":[{"from":"5511999999999","type":"text","text":{"body":"Olá"}}]}}]}]}'
```

A resposta deve ser imediata `200 OK`. O processamento (OpenAI + envio ao WhatsApp) ocorre em background; para ver a resposta no WhatsApp é necessário um número e token válidos.

### 9. Observações

- **OpenAI no backend:** toda chamada à OpenAI é feita no servidor. A chave e os tokens da Meta nunca vão para o frontend.
- **ECS Fargate:** o serviço roda continuamente (sem cold start por inatividade), mas um redeploy substitui a task em execução — a Meta pode reenviar o webhook se a requisição cair durante a troca.

### 10. Exemplo de payload recebido (Meta) e resposta enviada

**Exemplo de payload que a Meta envia no POST (mensagem de texto):**

```json
{
  "object": "whatsapp_business_account",
  "entry": [{
    "id": "123456789",
    "changes": [{
      "field": "messages",
      "value": {
        "messaging_product": "whatsapp",
        "metadata": { "display_phone_number": "15550001234", "phone_number_id": "987654321" },
        "contacts": [{ "profile": { "name": "João" }, "wa_id": "5511999999999" }],
        "messages": [{
          "from": "5511999999999",
          "id": "wamid.xxx",
          "timestamp": "1633024800",
          "type": "text",
          "text": { "body": "Quero saber sobre automação" }
        }]
      }
    }]
  }]
}
```

**Exemplo de corpo enviado ao WhatsApp (resposta):**

```json
{
  "messaging_product": "whatsapp",
  "to": "5511999999999",
  "text": { "body": "Automação é o uso de tecnologia para executar tarefas com pouco ou nenhum trabalho humano. Em vendas, pode incluir respostas automáticas, qualificação de leads e follow-up." }
}
```

O servidor extrai o texto do usuário, chama a OpenAI com esse texto e envia o texto retornado no campo `text.body` para o número `from`.

## Stack

- **React 19** + **TypeScript**
- **Vite 7**
- **Tailwind CSS 4** (plugin Vite)
- **React Router** (rota única `/inbox`)

## Estrutura

- `src/pages/InboxPage.tsx` — Página principal (sidebar + área central)
- `src/components/` — ConversationList, ConversationListItem, ChatPanel, MessageBubble, ChatComposer
- `src/api/mockApi.ts` — API fake (promises + setTimeout)
- `src/types.ts` — Tipos `Conversation` e `Message`
- `src/utils/format.ts` — Formatação de datas/horas

## Funcionalidades

- **Sidebar (320px):** lista de conversas, busca por nome/telefone/mensagem, badge de não lidas, status (NOVO, EM ANDAMENTO, QUALIFICADO, HANDOFF)
- **Área central:** header do lead (nome, telefone, status, botão “Handoff para humano”), mensagens em bolhas (lead à esquerda, agente à direita), separadores de data, composer com Enter para enviar e Shift+Enter para quebra de linha
- **Responsivo:** em mobile a sidebar vira drawer (botão ☰ para abrir/fechar)
- **Mock:** carregamento com delay, envio com optimistic UI e resposta simulada do lead após ~1,2s

## Build

```bash
npm run build
npm run preview   # preview da build
```
