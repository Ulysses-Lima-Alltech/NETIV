-- Contract for contacts.contact_type (CLIENT | INTERNO), preserving write compatibility.

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS contact_type TEXT;

UPDATE contacts
SET
  contact_type = CASE
    WHEN upper(trim(COALESCE(contact_type, 'CLIENT'))) IN ('INTERNO', 'INTERNAL', 'CORRETOR', 'ADMIN')
      THEN 'INTERNO'
    ELSE 'CLIENT'
  END,
  updated_at = NOW()
WHERE contact_type IS NULL
   OR trim(contact_type) = ''
   OR contact_type IS DISTINCT FROM CASE
     WHEN upper(trim(COALESCE(contact_type, 'CLIENT'))) IN ('INTERNO', 'INTERNAL', 'CORRETOR', 'ADMIN')
       THEN 'INTERNO'
     ELSE 'CLIENT'
   END;

ALTER TABLE contacts
  ALTER COLUMN contact_type SET DEFAULT 'CLIENT',
  ALTER COLUMN contact_type SET NOT NULL;

CREATE OR REPLACE FUNCTION trg_contacts_normalize_contact_type()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  norm TEXT;
BEGIN
  norm := upper(trim(COALESCE(NEW.contact_type, 'CLIENT')));

  IF norm IN ('INTERNO', 'INTERNAL', 'CORRETOR', 'ADMIN') THEN
    NEW.contact_type := 'INTERNO';
  ELSE
    NEW.contact_type := 'CLIENT';
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.updated_at := COALESCE(NEW.updated_at, NOW());
  ELSE
    NEW.updated_at := NOW();
  END IF;

  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_contacts_normalize_contact_type'
      AND tgrelid = 'contacts'::regclass
  ) THEN
    CREATE TRIGGER trg_contacts_normalize_contact_type
      BEFORE INSERT OR UPDATE OF contact_type
      ON contacts
      FOR EACH ROW
      EXECUTE FUNCTION trg_contacts_normalize_contact_type();
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_contacts_contact_type_contract') THEN
    ALTER TABLE contacts
      ADD CONSTRAINT chk_contacts_contact_type_contract
      CHECK (contact_type IN ('CLIENT', 'INTERNO'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_contacts_contact_type
  ON contacts (contact_type);
