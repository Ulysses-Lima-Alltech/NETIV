ALTER TABLE whatsapp_template_media_settings
ADD COLUMN IF NOT EXISTS header_media_id TEXT,
ADD COLUMN IF NOT EXISTS header_media_filename TEXT,
ADD COLUMN IF NOT EXISTS header_media_mime_type TEXT,
ADD COLUMN IF NOT EXISTS header_media_size_bytes BIGINT,
ADD COLUMN IF NOT EXISTS header_media_uploaded_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS storage_folder TEXT DEFAULT 'disparos',
ADD COLUMN IF NOT EXISTS file_bytes BYTEA;
