-- Backfill seguro para contatos já impactados por templates de corretor/interno.
-- Critério: contato vinculado a conversa com evidência de envio dos templates
-- convite_meeting_ecogarden ou novo_agendamento_corretor.

UPDATE contacts c
SET contact_type = 'INTERNO',
    updated_at = NOW()
WHERE COALESCE(c.contact_type, 'CLIENT') <> 'INTERNO'
  AND EXISTS (
    SELECT 1
    FROM conversations conv
    WHERE conv.contact_id = c.id
      AND (
        COALESCE(conv.lead_source_raw ->> 'sourceKey', '') IN (
          'batch:convite_meeting_ecogarden',
          'batch:novo_agendamento_corretor'
        )
        OR EXISTS (
          SELECT 1
          FROM messages m
          WHERE m.conversation_id = conv.id
            AND m.role = 'assistant'
            AND (
              m.content IN (
                '[template:convite_meeting_ecogarden]',
                '[template:novo_agendamento_corretor]'
              )
              OR m.content LIKE 'Fala, corretor(a)!%'
            )
        )
      )
  );
