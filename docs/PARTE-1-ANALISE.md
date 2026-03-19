# Parte 1 — Análise da estrutura atual

## Stack identificado

| Camada | Tecnologia |
|--------|------------|
| Frontend | React 19, Vite 7, TypeScript, React Router 7, Tailwind CSS 4 |
| Backend | Node.js, Express 4, TypeScript (tsx), CORS |
| Banco | SQLite (better-sqlite3), sem ORM |
| Migrations | SQL puro em `server/db/migrations/`, executadas na primeira abertura do DB |

Não há Prisma, TypeORM, Drizzle nem outro ORM. Não há sistema de autenticação/autorização no projeto.

---

## Organização do backend

- **Entrada**: `server/index.ts` — Express, `express.json()`, CORS, monta rotas em `/api`.
- **Rotas**: `server/routes/index.ts` agrega sub-rotas:
  - `/settings/integrations` → settingsRouter
  - `/whatsapp` → whatsappRouter
  - `/webhook/whatsapp` → webhookRouter
- **Padrão**: não há controllers separados; a lógica de rota chama repositórios e serviços diretamente.
- **Repositórios**: `server/repositories/*.ts` — acesso ao SQLite (prepare/run/get/all), retornam tipos tipados (row interfaces).
- **Serviços**: `server/services/*.ts` — regras de negócio (ex.: envio à Meta, processamento de webhook).
- **Tipos**: `server/types/*.ts` — interfaces/DTOs compartilhados.
- **Config**: `server/config.ts` — variáveis de ambiente (PORT, DB_PATH, etc.).
- **DB**: `server/db/index.ts` — singleton do SQLite, execução das migrations em ordem ao primeiro `getDb()`.

Convenções de nome: **snake_case** no banco, **camelCase** nos tipos TypeScript.

---

## Organização do frontend

- **Entrada**: `src/main.tsx` → `App.tsx` com React Router.
- **Rotas**: rotas em `App.tsx` (path element); não há módulo de rotas separado.
- **Páginas**: `src/pages/*.tsx` — uma por rota (InboxPage, SettingsWhatsAppPage, AgendaPage, etc.).
- **Componentes**: `src/components/*.tsx` — reutilizáveis (ConversationList, ChatPanel, ChatComposer, MessageBubble, etc.).
- **API**: `src/api/client.ts` — funções que fazem `fetch` para `/api/*`; `mockApi.ts` para dados mock do inbox.
- **Tipos**: `src/types.ts` — tipos globais do front (Conversation, Message, etc.).
- **Utilitários**: `src/utils/format.ts` — formatação de datas e status.
- **Estilos**: `src/index.css` + Tailwind; sem CSS modules.

Não há hooks customizados de API (react-query, SWR); uso direto de `useState`/`useEffect` e `fetch`.

---

## Banco, migrations e “schema”

- **Banco**: um arquivo SQLite em `server/data/inbox.db` (caminho configurável por `DB_PATH`).
- **Migrations**: arquivos `001_*.sql` … `004_*.sql` em `server/db/migrations/`; executados em ordem no primeiro `getDb()`; não há tabela de controle de migrations (cada arquivo é idempotente com `CREATE TABLE IF NOT EXISTS` / `INSERT OR IGNORE`).
- **ORM**: nenhum; queries são SQL escrito à mão nos repositórios.
- **Autenticação**: não existe; rotas são abertas.

---

## Padrão de rotas, services, páginas e componentes

- **Rotas (backend)**: um Router por domínio (settings, whatsapp, webhook); métodos HTTP nos mesmos arquivos de rota; validação mínima (typeof).
- **Services**: funções puras ou que recebem repositórios/dados; não acessam `req`/`res`; erros retornados como objeto ou lançados.
- **Frontend**: página = container que usa estado local + chamadas ao `client.ts`; componentes apresentacionais recebem props; sem store global (Redux/Zustand).
- **Estilos**: classes Tailwind; padrão de bordas `border-gray-200`, botões primários `bg-blue-500`, inputs com `focus:ring-blue-500`.

---

## O que foi encontrado e decisões

- **Módulo de settings**: já existe `server/routes/settings.ts` e `server/repositories/whatsappConfigRepository.ts` para integração WhatsApp; tabela `integration_settings` com uma linha por “integration_type”.  
  **Decisão**: reutilizar esse módulo; estender a tabela/rep para suportar `provider` (ex.: `whatsapp_meta`), `default_country_code` e `created_at`; manter uma configuração ativa por provider.
- **Conversations/Messages**: já existem tabelas `conversations` e `messages` e repositórios correspondentes.  
  **Decisão**: manter e evoluir; adicionar colunas que faltam (`last_message_at` em conversas; em mensagens: `type`, `error_message`, `sent_at`, `delivered_at`, `read_at`) sem quebrar o que já existe; manter nomes de coluna em snake_case e expor camelCase na API.
- **Webhook**: já existe GET/POST em `/api/webhook/whatsapp`.  
  **Decisão**: manter essa rota; adicionar alias ou rota em `/api/webhooks/whatsapp` para alinhar ao spec; processamento de status (sent, delivered, read, failed) e atualização de mensagens outbound no serviço de webhook.
- **Validação**: não há zod/yup no backend.  
  **Decisão**: introduzir **zod** apenas no servidor para DTOs de entrada (PUT settings, POST send, etc.) e manter o restante do código como está.
- **Teste de conexão**: não existe endpoint de teste.  
  **Decisão**: criar **POST /api/settings/integrations/whatsapp/test** que, com a config salva, chama a API da Meta (ex.: GET do Phone Number ou endpoint leve) e retorna sucesso/falha e mensagem amigável.

---

## Padrão escolhido e motivo

- **Manter**: Express + SQLite + migrations SQL + repositórios com SQL direto + serviços sem acesso a req/res.
- **Seguir**: mesmo padrão de rotas (Router por domínio), mesmo estilo de tipos em `server/types`, mesma convenção snake_case (DB) / camelCase (TS).
- **Adicionar**: zod apenas para validação de payloads nas rotas; DTOs explícitos para request/response; máscara de token em respostas já existente; endpoint de teste que usa a config salva e chama a Meta.
- **Motivo**: o projeto já tem uma base coerente (repos, services, routes, types). A integração WhatsApp já está nesse molde. A decisão é **encaixar** as novas funcionalidades (test, listagem de conversas/mensagens, webhook com status, validação, campos extras) no mesmo padrão, sem criar uma “arquitetura paralela” (ex.: sem adicionar camada de controllers ou outro ORM). Assim a base fica única, escalável e fácil de evoluir (ex.: mais providers, mais canais, GPT depois).
