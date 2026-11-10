import { query } from '../db/pg.js';
import { ANA_EMERGENCY_HANDOFF_MESSAGE } from '../constants/anaMessages.js';

export interface UnclassifiedLeadSettings {
  initialMessage: string | null;
  followUpMessage: string | null;
  defaultMessage: string;
}

export async function getUnclassifiedLeadSettings(): Promise<UnclassifiedLeadSettings> {
  const { rows } = await query<{ initial_message: string | null; follow_up_message: string | null }>(
    'SELECT initial_message, follow_up_message FROM ana_unclassified_lead_settings WHERE id = 1'
  );

  return {
    initialMessage: rows[0]?.initial_message?.trim() || null,
    followUpMessage: rows[0]?.follow_up_message?.trim() || null,
    defaultMessage: ANA_EMERGENCY_HANDOFF_MESSAGE,
  };
}

export async function saveUnclassifiedLeadSettings(
  initialMessage: string | null,
  followUpMessage?: string | null
): Promise<UnclassifiedLeadSettings> {
  await query(
    `INSERT INTO ana_unclassified_lead_settings (id, initial_message)
     VALUES (1, $1)
     ON CONFLICT (id) DO UPDATE
       SET initial_message = EXCLUDED.initial_message,
           follow_up_message = CASE
             WHEN $2::boolean THEN $3::text
             ELSE ana_unclassified_lead_settings.follow_up_message
           END,
           updated_at = NOW()`,
    [initialMessage?.trim() || null, followUpMessage !== undefined, followUpMessage?.trim() || null]
  );

  return getUnclassifiedLeadSettings();
}
