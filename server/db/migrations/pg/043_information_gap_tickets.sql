-- Tickets canônicos de lacuna de informação.

CREATE OR REPLACE FUNCTION normalize_information_gap_subject(input_text TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
RETURNS NULL ON NULL INPUT
AS $$
  SELECT NULLIF(regexp_replace(lower(trim(input_text)), '\s+', ' ', 'g'), '')
$$;

CREATE TABLE IF NOT EXISTS information_gap_tickets (
  id BIGSERIAL PRIMARY KEY,
  conversation_id INT NOT NULL
);

ALTER TABLE information_gap_tickets
  ADD COLUMN IF NOT EXISTS enterprise_id INT,
  ADD COLUMN IF NOT EXISTS contact_id BIGINT,
  ADD COLUMN IF NOT EXISTS subject TEXT,
  ADD COLUMN IF NOT EXISTS subject_normalized TEXT,
  ADD COLUMN IF NOT EXISTS status VARCHAR(24),
  ADD COLUMN IF NOT EXISTS priority VARCHAR(16),
  ADD COLUMN IF NOT EXISTS first_turn_audit_id BIGINT,
  ADD COLUMN IF NOT EXISTS last_turn_audit_id BIGINT,
  ADD COLUMN IF NOT EXISTS occurrences INT,
  ADD COLUMN IF NOT EXISTS opened_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolution_note TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

UPDATE information_gap_tickets t
SET
  enterprise_id = COALESCE(t.enterprise_id, c.enterprise_id),
  contact_id = COALESCE(t.contact_id, c.contact_id)
FROM conversations c
WHERE c.id = t.conversation_id;

UPDATE information_gap_tickets
SET
  subject = COALESCE(NULLIF(trim(subject), ''), 'nao_classificado'),
  subject_normalized = COALESCE(
    NULLIF(normalize_information_gap_subject(COALESCE(subject, 'nao_classificado')), ''),
    'nao_classificado'
  ),
  status = CASE
    WHEN upper(trim(COALESCE(status, 'OPEN'))) IN ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'WONT_FIX')
      THEN upper(trim(COALESCE(status, 'OPEN')))
    ELSE 'OPEN'
  END,
  priority = CASE
    WHEN upper(trim(COALESCE(priority, 'MEDIUM'))) IN ('LOW', 'MEDIUM', 'HIGH')
      THEN upper(trim(COALESCE(priority, 'MEDIUM')))
    ELSE 'MEDIUM'
  END,
  occurrences = GREATEST(COALESCE(occurrences, 1), 1),
  created_at = COALESCE(created_at, NOW()),
  opened_at = COALESCE(opened_at, created_at, NOW()),
  resolved_at = CASE
    WHEN upper(trim(COALESCE(status, 'OPEN'))) IN ('RESOLVED', 'WONT_FIX')
      THEN COALESCE(resolved_at, NOW())
    ELSE NULL
  END,
  updated_at = COALESCE(updated_at, NOW())
WHERE subject IS NULL
   OR trim(subject) = ''
   OR subject_normalized IS NULL
   OR trim(subject_normalized) = ''
   OR status IS NULL
   OR priority IS NULL
   OR occurrences IS NULL
   OR occurrences < 1
   OR opened_at IS NULL
   OR created_at IS NULL
   OR updated_at IS NULL
   OR upper(trim(COALESCE(status, 'OPEN'))) NOT IN ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'WONT_FIX')
   OR upper(trim(COALESCE(priority, 'MEDIUM'))) NOT IN ('LOW', 'MEDIUM', 'HIGH');

ALTER TABLE information_gap_tickets
  ALTER COLUMN subject SET NOT NULL,
  ALTER COLUMN subject_normalized SET NOT NULL,
  ALTER COLUMN status SET DEFAULT 'OPEN',
  ALTER COLUMN status SET NOT NULL,
  ALTER COLUMN priority SET DEFAULT 'MEDIUM',
  ALTER COLUMN priority SET NOT NULL,
  ALTER COLUMN occurrences SET DEFAULT 1,
  ALTER COLUMN occurrences SET NOT NULL,
  ALTER COLUMN opened_at SET DEFAULT NOW(),
  ALTER COLUMN opened_at SET NOT NULL,
  ALTER COLUMN created_at SET DEFAULT NOW(),
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN updated_at SET DEFAULT NOW(),
  ALTER COLUMN updated_at SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_igt_conversation') THEN
    ALTER TABLE information_gap_tickets
      ADD CONSTRAINT fk_igt_conversation
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_igt_enterprise') THEN
    ALTER TABLE information_gap_tickets
      ADD CONSTRAINT fk_igt_enterprise
      FOREIGN KEY (enterprise_id) REFERENCES enterprises(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_igt_contact') THEN
    ALTER TABLE information_gap_tickets
      ADD CONSTRAINT fk_igt_contact
      FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_igt_first_turn_audit') THEN
    ALTER TABLE information_gap_tickets
      ADD CONSTRAINT fk_igt_first_turn_audit
      FOREIGN KEY (first_turn_audit_id) REFERENCES ana_turn_audit(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_igt_last_turn_audit') THEN
    ALTER TABLE information_gap_tickets
      ADD CONSTRAINT fk_igt_last_turn_audit
      FOREIGN KEY (last_turn_audit_id) REFERENCES ana_turn_audit(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_igt_subject_not_blank') THEN
    ALTER TABLE information_gap_tickets
      ADD CONSTRAINT chk_igt_subject_not_blank
      CHECK (length(trim(subject)) > 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_igt_subject_normalized_not_blank') THEN
    ALTER TABLE information_gap_tickets
      ADD CONSTRAINT chk_igt_subject_normalized_not_blank
      CHECK (length(trim(subject_normalized)) > 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_igt_status') THEN
    ALTER TABLE information_gap_tickets
      ADD CONSTRAINT chk_igt_status
      CHECK (status IN ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'WONT_FIX'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_igt_priority') THEN
    ALTER TABLE information_gap_tickets
      ADD CONSTRAINT chk_igt_priority
      CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_igt_occurrences') THEN
    ALTER TABLE information_gap_tickets
      ADD CONSTRAINT chk_igt_occurrences
      CHECK (occurrences >= 1);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_igt_resolution_consistency') THEN
    ALTER TABLE information_gap_tickets
      ADD CONSTRAINT chk_igt_resolution_consistency
      CHECK (
        (status IN ('RESOLVED', 'WONT_FIX') AND resolved_at IS NOT NULL)
        OR
        (status IN ('OPEN', 'IN_PROGRESS') AND resolved_at IS NULL)
      );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION trg_information_gap_tickets_normalize()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.subject := COALESCE(NULLIF(trim(NEW.subject), ''), 'nao_classificado');
  NEW.subject_normalized := COALESCE(
    NULLIF(normalize_information_gap_subject(NEW.subject), ''),
    'nao_classificado'
  );

  NEW.status := upper(trim(COALESCE(NEW.status, 'OPEN')));
  IF NEW.status NOT IN ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'WONT_FIX') THEN
    NEW.status := 'OPEN';
  END IF;

  NEW.priority := upper(trim(COALESCE(NEW.priority, 'MEDIUM')));
  IF NEW.priority NOT IN ('LOW', 'MEDIUM', 'HIGH') THEN
    NEW.priority := 'MEDIUM';
  END IF;

  NEW.occurrences := GREATEST(COALESCE(NEW.occurrences, 1), 1);
  NEW.created_at := COALESCE(NEW.created_at, NOW());
  NEW.opened_at := COALESCE(NEW.opened_at, NEW.created_at);

  IF NEW.status IN ('RESOLVED', 'WONT_FIX') THEN
    NEW.resolved_at := COALESCE(NEW.resolved_at, NOW());
  ELSE
    NEW.resolved_at := NULL;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.updated_at := COALESCE(NEW.updated_at, NEW.created_at);
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
    WHERE tgname = 'trg_information_gap_tickets_normalize'
      AND tgrelid = 'information_gap_tickets'::regclass
  ) THEN
    CREATE TRIGGER trg_information_gap_tickets_normalize
      BEFORE INSERT OR UPDATE
      ON information_gap_tickets
      FOR EACH ROW
      EXECUTE FUNCTION trg_information_gap_tickets_normalize();
  END IF;
END $$;

WITH audit_src AS (
  SELECT
    a.id,
    a.conversation_id,
    COALESCE(a.enterprise_id, c.enterprise_id) AS enterprise_id,
    c.contact_id,
    COALESCE(NULLIF(trim(a.missing_information_subject), ''), 'nao_classificado') AS subject,
    normalize_information_gap_subject(
      COALESCE(NULLIF(trim(a.missing_information_subject), ''), 'nao_classificado')
    ) AS subject_normalized,
    a.created_at
  FROM ana_turn_audit a
  LEFT JOIN conversations c ON c.id = a.conversation_id
  WHERE a.missing_information_flag_created = true
),
ranked AS (
  SELECT
    s.*,
    ROW_NUMBER() OVER (
      PARTITION BY s.conversation_id, s.subject_normalized
      ORDER BY s.created_at ASC, s.id ASC
    ) AS rn_first,
    ROW_NUMBER() OVER (
      PARTITION BY s.conversation_id, s.subject_normalized
      ORDER BY s.created_at DESC, s.id DESC
    ) AS rn_last
  FROM audit_src s
  WHERE s.subject_normalized IS NOT NULL
),
agg AS (
  SELECT
    conversation_id,
    MAX(enterprise_id) FILTER (WHERE enterprise_id IS NOT NULL) AS enterprise_id,
    MAX(contact_id) FILTER (WHERE contact_id IS NOT NULL) AS contact_id,
    MAX(subject) FILTER (WHERE rn_first = 1) AS subject,
    subject_normalized,
    MAX(id) FILTER (WHERE rn_first = 1) AS first_turn_audit_id,
    MAX(id) FILTER (WHERE rn_last = 1) AS last_turn_audit_id,
    COUNT(*)::INT AS occurrences,
    MIN(created_at) AS opened_at,
    MAX(created_at) AS updated_at
  FROM ranked
  GROUP BY conversation_id, subject_normalized
)
INSERT INTO information_gap_tickets (
  conversation_id,
  enterprise_id,
  contact_id,
  subject,
  subject_normalized,
  status,
  priority,
  first_turn_audit_id,
  last_turn_audit_id,
  occurrences,
  opened_at,
  resolved_at,
  resolution_note,
  created_at,
  updated_at
)
SELECT
  a.conversation_id,
  a.enterprise_id,
  a.contact_id,
  COALESCE(NULLIF(trim(a.subject), ''), 'nao_classificado'),
  a.subject_normalized,
  'OPEN',
  'MEDIUM',
  a.first_turn_audit_id,
  a.last_turn_audit_id,
  GREATEST(a.occurrences, 1),
  COALESCE(a.opened_at, NOW()),
  NULL,
  NULL,
  COALESCE(a.opened_at, NOW()),
  COALESCE(a.updated_at, NOW())
FROM agg a
WHERE NOT EXISTS (
  SELECT 1
  FROM information_gap_tickets t
  WHERE t.conversation_id = a.conversation_id
    AND t.subject_normalized = a.subject_normalized
    AND t.status IN ('OPEN', 'IN_PROGRESS')
);

WITH ranked_open AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY conversation_id, subject_normalized
      ORDER BY opened_at ASC, created_at ASC, id ASC
    ) AS rn
  FROM information_gap_tickets
  WHERE status IN ('OPEN', 'IN_PROGRESS')
)
UPDATE information_gap_tickets t
SET
  status = 'WONT_FIX',
  resolved_at = COALESCE(t.resolved_at, NOW()),
  resolution_note = COALESCE(NULLIF(t.resolution_note, ''), 'Auto-resolvido: ticket duplicado durante migration'),
  updated_at = NOW()
FROM ranked_open ro
WHERE t.id = ro.id
  AND ro.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_igt_open_subject_per_conversation
  ON information_gap_tickets (conversation_id, subject_normalized)
  WHERE status IN ('OPEN', 'IN_PROGRESS');

CREATE INDEX IF NOT EXISTS idx_igt_status_priority_opened
  ON information_gap_tickets (status, priority, opened_at DESC);

CREATE INDEX IF NOT EXISTS idx_igt_conversation_status_opened
  ON information_gap_tickets (conversation_id, status, opened_at DESC);

CREATE INDEX IF NOT EXISTS idx_igt_contact_opened
  ON information_gap_tickets (contact_id, opened_at DESC);

CREATE INDEX IF NOT EXISTS idx_igt_first_turn_audit
  ON information_gap_tickets (first_turn_audit_id)
  WHERE first_turn_audit_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_igt_last_turn_audit
  ON information_gap_tickets (last_turn_audit_id)
  WHERE last_turn_audit_id IS NOT NULL;
