-- Habilita resposta automática da ANA quando OpenAI API Key está configurada.
-- Corrige o caso em que ai_enabled ficou false por padrão mas a instalação
-- já usa a IA. ANA deve responder automaticamente quando a chave existe.
UPDATE integration_settings
SET ai_enabled = true
WHERE id = 1
  AND openai_api_key IS NOT NULL
  AND trim(openai_api_key) != '';
