# Exclusão Definitiva de Empreendimentos + Sincronismo de Menu

## Visão geral

Antes desta mudança, o botão de exclusão de empreendimento em `DELETE /projects/:id` fazia apenas **soft delete** (`status = 'inativo'`). O registro continuava no banco para sempre, mesmo sem uso, aumentando o tamanho do banco na AWS sem necessidade.

Esta mudança adiciona uma **exclusão definitiva (hard delete)** acionável a partir da tela **Configuração de API**, com cascata segura no banco, e sincroniza a lista de empreendimentos entre:

- a tela **Configuração de API** (`/settings/integrations/whatsapp`)
- a página **Empreendimentos** (`/settings/empreendimentos`)
- o **menu lateral** (sidebar)

## Por que a exclusão é segura

A maior parte das tabelas relacionadas a `enterprises` já está configurada no banco com `ON DELETE CASCADE`. Isso significa que o **próprio Postgres** apaga os registros filhos automaticamente quando o empreendimento é apagado — não foi necessário escrever `DELETE` manual para cada tabela.

Tabelas que são apagadas em cascata automaticamente:

- `enterprise_variables`
- `enterprise_files`
- `enterprise_knowledge_chunks`
- `enterprise_ai_settings`
- `enterprise_prompt_addons_history`
- `enterprise_aliases`
- `mobile_user_enterprises`
- `corretor_empreendimentos`
- `broker_assignment_queue_state`

Tabelas que apenas desvinculam (`ON DELETE SET NULL`), preservando histórico:

- `contacts`, `conversations`, `ana_turn_audit`, `information_gap_tickets`, `llm_usage`, `whatsapp_batch_scheduled_sends`

**Único ponto de bloqueio real**: a tabela `appointments` usa `ON DELETE RESTRICT`. Se o empreendimento tiver agendamentos vinculados, o Postgres **recusa a exclusão** para não perder histórico de agenda sem querer. O backend detecta esse caso (código de erro Postgres `23503`) e devolve uma mensagem amigável em vez de um erro técnico.

## O que foi implementado

### 1. Backend — função de exclusão definitiva

**Arquivo**: `server/repositories/enterpriseRepository.ts`

Nova função `deleteEnterprisePermanently(id)`:

- Abre uma transação (`BEGIN` / `COMMIT` / `ROLLBACK`).
- Trava a linha com `FOR UPDATE` para evitar exclusão concorrente.
- Confirma que o empreendimento existe antes de apagar.
- Executa `DELETE FROM enterprises WHERE id = $1`.
- Se o Postgres recusar por FK (`error.code === '23503'`), devolve `{ ok: false, reason: 'has_appointments' }` em vez de lançar um erro genérico.

```ts
export type DeleteEnterprisePermanentlyResult =
  | { ok: true }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'has_appointments' };

export async function deleteEnterprisePermanently(
  id: number
): Promise<DeleteEnterprisePermanentlyResult> { /* ... */ }
```

### 2. Backend — rota HTTP

**Arquivo**: `server/routes/settingsAi.ts`

Nova rota:

```
DELETE /settings/api/enterprises/:enterpriseId
```

Respostas:

| Situação | Status | Corpo |
|---|---|---|
| `enterpriseId` inválido | `400` | `{ error: 'enterpriseId invalido.' }` |
| Empreendimento não existe | `404` | `{ error: 'Empreendimento nao encontrado.' }` |
| Empreendimento tem agendamentos | `409` | `{ error: 'Este empreendimento possui agendamentos vinculados e nao pode ser excluido definitivamente.' }` |
| Sucesso | `200` | `{ ok: true }` |
| Erro inesperado | `500` | `{ error: 'Erro ao excluir empreendimento.' }` |

### 3. Frontend — client de API

**Arquivo**: `src/api/client.ts`

Nova função em `settingsApi`:

```ts
deleteApiEnterprise: (enterpriseId: number) =>
  request<{ ok: boolean }>(`/settings/api/enterprises/${enterpriseId}`, {
    method: 'DELETE',
  }),
```

### 4. Frontend — botão na tela de Configuração de API

**Arquivo**: `src/pages/SettingsWhatsAppPage.tsx`

- Novo estado `deletingEnterpriseId` para controlar qual card está excluindo.
- Novo handler `handleDeleteEnterprise(enterpriseId, enterpriseName)`:
  - Pede confirmação com `window.confirm`.
  - Chama `settingsApi.deleteApiEnterprise`.
  - Recarrega a lista com `loadApiSettings()` para o card sumir imediatamente.
  - Mostra mensagem de sucesso ou erro (inclusive a mensagem de bloqueio por agendamentos).
- Novo botão **"Excluir definitivamente"** (vermelho) ao lado de "Salvar" e "Testar conexão" em cada card de empreendimento.

### 5. Frontend — sincronismo com o menu lateral

**Arquivo novo**: `src/hooks/useEnterprisesMenu.ts`

Hook que busca a lista de empreendimentos ativos (`projectsApi.list(true)`) e expõe `{ enterprises, reload }`.

**Arquivo**: `src/components/layout/SidebarNav.tsx`

- Usa `useEnterprisesMenu()` para buscar os empreendimentos.
- Sob o item de menu "Empreendimentos", renderiza um submenu com o nome de cada empreendimento existente, como link direto para `/settings/empreendimentos?id={id}`.
- Como o hook busca do backend, assim que um empreendimento é excluído, ele **deixa de existir na resposta da API** e some do submenu na próxima carga da página.

**Arquivo**: `src/index.css`

- Novas classes `.netiv-sidebar__submenu` e `.netiv-sidebar__subitem` para estilizar a lista de empreendimentos no menu.
- Regra para esconder o submenu quando o sidebar está recolhido (`is-collapsed`).

### 6. Página de Empreendimentos

**Arquivo**: `src/pages/EmpreendimentosPage.tsx`

Nenhuma mudança estrutural foi necessária: essa página já busca `projectsApi.list(false, f)`, refletindo o estado real do banco a cada carregamento. Assim que um empreendimento é excluído definitivamente pela tela de API, ele some automaticamente daqui também.

## Fluxo completo, resumido

```
Usuário clica em "Excluir definitivamente" no card do empreendimento
        │
        ▼
Confirmação (window.confirm)
        │
        ▼
DELETE /settings/api/enterprises/:id  (settingsAi.ts)
        │
        ▼
deleteEnterprisePermanently(id)  (enterpriseRepository.ts)
        │
        ├── Empreendimento tem agendamentos? ──► 409 + mensagem amigável (nada é apagado)
        │
        └── OK ──► DELETE FROM enterprises ──► cascade automático do Postgres
                        │
                        ▼
        Lista recarregada na tela de API (card some)
        Sidebar recarrega e nome some do submenu
        Página de Empreendimentos reflete o mesmo estado na próxima carga
```

## Pontos de atenção para quem revisa o PR

- **Não existe rollback de UI**: a exclusão é física e definitiva. Não há "lixeira" ou forma de desfazer pela interface.
- **Rota antiga `DELETE /projects/:id`** (em `server/routes/projects.ts`) continua existindo e **ainda faz apenas soft delete** (`inactivateEnterprise`). Ela não foi alterada nem removida nesta mudança — os dois comportamentos (soft delete antigo vs. hard delete novo) coexistem propositalmente até uma decisão futura sobre unificar ou aposentar a rota antiga.
- **Nenhum comando de banco (migration) foi necessário**: toda a cascata já existia previamente via `ON DELETE CASCADE`/`SET NULL`/`RESTRICT` nas migrations em `server/db/migrations/pg`.
- **Erros de lint pré-existentes**: `settingsAi.ts` já tinha avisos de `implicit any` em `req`/`res` de rotas antigas (linhas anteriores à mudança); a rota nova segue o mesmo padrão de tipagem do restante do arquivo.

## Arquivos alterados/criados nesta mudança

| Arquivo | Tipo de mudança |
|---|---|
| `server/repositories/enterpriseRepository.ts` | Nova função `deleteEnterprisePermanently` |
| `server/routes/settingsAi.ts` | Novo import + nova rota `DELETE /api/enterprises/:enterpriseId` |
| `src/api/client.ts` | Novo método `deleteApiEnterprise` |
| `src/pages/SettingsWhatsAppPage.tsx` | Novo estado, handler e botão de exclusão |
| `src/hooks/useEnterprisesMenu.ts` | **Arquivo novo** — hook de listagem para o sidebar |
| `src/components/layout/SidebarNav.tsx` | Uso do novo hook + submenu dinâmico |
| `src/index.css` | Novas classes de estilo para o submenu |

## Como testar manualmente

1. Acesse **Configuração de API** (`/settings/integrations/whatsapp`), aba de configuração por empreendimento.
2. Expanda um card de empreendimento sem agendamentos vinculados.
3. Clique em **"Excluir definitivamente"** e confirme.
4. Verifique que:
   - o card some da tela;
   - o nome some do submenu "Empreendimentos" no sidebar (pode ser necessário navegar/recarregar);
   - o empreendimento não aparece mais em `/settings/empreendimentos`.
5. Repita o teste com um empreendimento que **tenha agendamentos** na Agenda e confirme que aparece a mensagem de bloqueio, sem apagar nada.
