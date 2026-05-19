import { query } from '../db/pg.js';

export interface WhatsAppTemplateMediaSetting {
  id: number;
  templateName: string;
  language: string;
  headerImageUrl: string | null;
  headerMediaId: string | null;
  headerMediaFilename: string | null;
  headerMediaMimeType: string | null;
  headerMediaSizeBytes: number | null;
  headerMediaUploadedAt: string | null;
  storageFolder: string | null;
  fileBytes: Buffer | null;
  createdAt: string;
  updatedAt: string;
}

type MediaSettingRow = {
  id: number;
  template_name: string;
  language: string;
  header_image_url: string | null;
  header_media_id: string | null;
  header_media_filename: string | null;
  header_media_mime_type: string | null;
  header_media_size_bytes: number | null;
  header_media_uploaded_at: string | null;
  storage_folder: string | null;
  file_bytes: Buffer | null;
  created_at: string;
  updated_at: string;
};

function mapRow(row: MediaSettingRow): WhatsAppTemplateMediaSetting {
  return {
    id: row.id,
    templateName: row.template_name,
    language: row.language,
    headerImageUrl: row.header_image_url,
    headerMediaId: row.header_media_id,
    headerMediaFilename: row.header_media_filename,
    headerMediaMimeType: row.header_media_mime_type,
    headerMediaSizeBytes: row.header_media_size_bytes,
    headerMediaUploadedAt: row.header_media_uploaded_at,
    storageFolder: row.storage_folder,
    fileBytes: row.file_bytes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeLanguage(language: string | null | undefined): string {
  const value = String(language ?? 'pt_BR').trim();
  return value || 'pt_BR';
}

export async function getMediaSetting(templateName: string, language: string): Promise<WhatsAppTemplateMediaSetting | null> {
  const { rows } = await query<MediaSettingRow>(
    `SELECT id, template_name, language, header_image_url, header_media_id, header_media_filename,
            header_media_mime_type, header_media_size_bytes, header_media_uploaded_at, storage_folder,
            file_bytes, created_at, updated_at
       FROM whatsapp_template_media_settings
      WHERE template_name = $1 AND language = $2
      LIMIT 1`,
    [templateName.trim(), normalizeLanguage(language)]
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function listMediaSettings(): Promise<WhatsAppTemplateMediaSetting[]> {
  const { rows } = await query<MediaSettingRow>(
    `SELECT id, template_name, language, header_image_url, header_media_id, header_media_filename,
            header_media_mime_type, header_media_size_bytes, header_media_uploaded_at, storage_folder,
            file_bytes, created_at, updated_at
       FROM whatsapp_template_media_settings
      ORDER BY template_name, language`
  );
  return rows.map(mapRow);
}

export async function upsertHeaderImageUpload(params: {
  templateName: string;
  language: string;
  fileBytes: Buffer;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  headerMediaId: string;
  headerImageUrl?: string | null;
}): Promise<WhatsAppTemplateMediaSetting> {
  const { rows } = await query<MediaSettingRow>(
    `INSERT INTO whatsapp_template_media_settings (
       template_name, language, header_image_url, header_media_id, header_media_filename,
       header_media_mime_type, header_media_size_bytes, header_media_uploaded_at, storage_folder, file_bytes
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),'disparos',$8)
     ON CONFLICT (template_name, language)
     DO UPDATE SET
       header_image_url = COALESCE(EXCLUDED.header_image_url, whatsapp_template_media_settings.header_image_url),
       header_media_id = EXCLUDED.header_media_id,
       header_media_filename = EXCLUDED.header_media_filename,
       header_media_mime_type = EXCLUDED.header_media_mime_type,
       header_media_size_bytes = EXCLUDED.header_media_size_bytes,
       header_media_uploaded_at = NOW(),
       storage_folder = 'disparos',
       file_bytes = EXCLUDED.file_bytes,
       updated_at = NOW()
     RETURNING id, template_name, language, header_image_url, header_media_id, header_media_filename,
               header_media_mime_type, header_media_size_bytes, header_media_uploaded_at, storage_folder,
               file_bytes, created_at, updated_at`,
    [
      params.templateName.trim(),
      normalizeLanguage(params.language),
      params.headerImageUrl?.trim() || null,
      params.headerMediaId.trim(),
      params.filename.trim(),
      params.mimeType.trim(),
      params.sizeBytes,
      params.fileBytes,
    ]
  );
  return mapRow(rows[0]);
}

export async function clearHeaderMedia(templateName: string, language: string): Promise<void> {
  await query(
    `UPDATE whatsapp_template_media_settings
        SET header_media_id = NULL,
            header_media_filename = NULL,
            header_media_mime_type = NULL,
            header_media_size_bytes = NULL,
            header_media_uploaded_at = NULL,
            file_bytes = NULL,
            updated_at = NOW()
      WHERE template_name = $1 AND language = $2`,
    [templateName.trim(), normalizeLanguage(language)]
  );
}

