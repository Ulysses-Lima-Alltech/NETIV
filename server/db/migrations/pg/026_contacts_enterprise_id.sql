-- Vínculo canônico do contato ao empreendimento (alinhado a conversations.enterprise_id).
-- enterprise_interest permanece como rótulo legado / CSV; preferir enterprise_id + nome via JOIN.

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS enterprise_id INT NULL REFERENCES enterprises(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_enterprise_id ON contacts(enterprise_id);

-- Backfill idempotente: melhor conversa por atividade recente, apenas empreendimento ativo.
UPDATE contacts c
SET
  enterprise_id = pick.enterprise_id,
  enterprise_interest = COALESCE(e.name, c.enterprise_interest),
  updated_at = NOW()
FROM (
  SELECT DISTINCT ON (conv.contact_id)
    conv.contact_id AS cid,
    conv.enterprise_id
  FROM conversations conv
  WHERE conv.contact_id IS NOT NULL
    AND conv.enterprise_id IS NOT NULL
  ORDER BY
    conv.contact_id,
    conv.last_message_at DESC NULLS LAST,
    conv.updated_at DESC,
    conv.id DESC
) pick
JOIN enterprises e ON e.id = pick.enterprise_id AND e.status = 'ativo'
WHERE c.id = pick.cid
  AND c.enterprise_id IS NULL;
