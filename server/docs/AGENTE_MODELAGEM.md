# Modelagem — Agente Ana (Netiv / Quero Meu Apê)

## Tabelas

| Tabela | Campos relevantes |
|--------|-------------------|
| **projects** | id, name, slug, active, language_style, variables_json, prompt_addons_json, created_at, updated_at |
| **project_knowledge_files** | id, project_id, stored_filename, original_name, mime, size, created_at |
| **conversations** | id, channel, external_id, contact_*, project_id, classification_status, lead_stage, … |
| **messages** | id, conversation_id, direction, body_text, content, meta_message_id, … |
| **integration_settings** | OpenAI, WhatsApp |

## Regras

- **project_id** nulo → triagem (Ana só descobre empreendimento, sem listar/portfólio).
- **project_id** + empreendimento ativo → escopo único; conhecimento só desse `project_id`.
- **Ativo** → pode usar; **inativo** → bloqueado para o agente.

## Arquivos (agente + empreendimentos)

| Caminho |
|---------|
| server/db/migrations/012_projects_table.sql, 013_empreendimento_agent.sql |
| server/db/index.ts |
| server/services/anaAgentService.ts |
| server/services/conversationEngine.ts |
| server/services/openaiService.ts |
| server/repositories/projectRepository.ts |
| server/repositories/projectMatch.ts |
| server/repositories/conversationRepository.ts |
| server/routes/projects.ts |
| server/routes/webhookMeta.ts |
| server/validators/projects.ts |
| src/api/client.ts |
| src/pages/EmpreendimentosPage.tsx |
| src/pages/InboxPage.tsx |
| src/components/ChatPanel.tsx |
| src/App.tsx |
| src/types.ts |
