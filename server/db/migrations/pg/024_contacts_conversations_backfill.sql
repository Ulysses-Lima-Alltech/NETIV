-- Backfill conversations.contact_id a partir do telefone (contact_phone ou external_contact_id),
-- alinhado a server/utils/phone.ts normalizePhoneE164.
-- Em seguida: seed de owner no contato legado (só se owner_user_id IS NULL) a partir de
-- conversations.assigned_broker_id, e sync final contact -> conversation (fonte da verdade = contact).

CREATE OR REPLACE FUNCTION migration_normalize_phone_e164(input text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  digits text;
BEGIN
  digits := regexp_replace(COALESCE(input, ''), '[^0-9]', '', 'g');
  IF digits = '' OR length(digits) < 10 THEN
    RETURN NULL;
  END IF;
  IF left(digits, 2) = '55' THEN
    RETURN digits;
  END IF;
  IF length(digits) IN (10, 11) THEN
    RETURN '55' || digits;
  END IF;
  RETURN digits;
END;
$$;

-- 1) Garantir linha em contacts para cada telefone normalizado ainda órfão em conversas WhatsApp
INSERT INTO contacts (full_name, first_name, phone_e164, phone_display, source, updated_at)
SELECT DISTINCT ON (pe.phone_e164)
  pe.full_name,
  NULLIF(trim(split_part(COALESCE(pe.full_name, ''), ' ', 1)), '') AS first_name,
  pe.phone_e164,
  pe.phone_display,
  'migration_backfill',
  NOW()
FROM (
  SELECT
    c.id AS conv_id,
    migration_normalize_phone_e164(COALESCE(c.contact_phone, c.external_contact_id)) AS phone_e164,
    NULLIF(trim(COALESCE(c.customer_name, c.whatsapp_display_name, '')), '') AS full_name,
    NULLIF(trim(COALESCE(c.contact_phone, c.external_contact_id, '')), '') AS phone_display
  FROM conversations c
  WHERE c.contact_id IS NULL
    AND c.channel = 'whatsapp'
) pe
WHERE pe.phone_e164 IS NOT NULL
ORDER BY pe.phone_e164, pe.conv_id
ON CONFLICT (phone_e164) DO NOTHING;

-- 2) Vincular conversas ao contato pelo telefone normalizado
UPDATE conversations conv
SET contact_id = ct.id,
    updated_at = NOW()
FROM contacts ct
WHERE conv.contact_id IS NULL
  AND conv.channel = 'whatsapp'
  AND ct.phone_e164 = migration_normalize_phone_e164(COALESCE(conv.contact_phone, conv.external_contact_id));

-- 3) Legado: se o contato ainda não tem dono, copiar assigned_broker_id da conversa (uma conversa por contato escolhida pelo menor id)
UPDATE contacts c
SET owner_user_id = s.assigned_broker_id,
    owner_assigned_at = COALESCE(c.owner_assigned_at, NOW()),
    owner_assignment_source = COALESCE(c.owner_assignment_source, 'legacy_conversation'),
    updated_at = NOW()
FROM (
  SELECT DISTINCT ON (conv.contact_id)
    conv.contact_id AS cid,
    conv.assigned_broker_id
  FROM conversations conv
  WHERE conv.contact_id IS NOT NULL
    AND conv.assigned_broker_id IS NOT NULL
  ORDER BY conv.contact_id, conv.id ASC
) s
WHERE c.id = s.cid
  AND c.owner_user_id IS NULL
  AND s.assigned_broker_id IS NOT NULL;

-- 4) Fonte da verdade: assigned_broker_id na conversa = owner do contato
UPDATE conversations conv
SET assigned_broker_id = c.owner_user_id,
    updated_at = NOW()
FROM contacts c
WHERE conv.contact_id = c.id
  AND conv.assigned_broker_id IS DISTINCT FROM c.owner_user_id;

DROP FUNCTION migration_normalize_phone_e164(text);
