CREATE TABLE IF NOT EXISTS whatsapp_template_media_settings (
  id BIGSERIAL PRIMARY KEY,
  template_name TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'pt_BR',
  header_image_url TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (template_name, language)
);
