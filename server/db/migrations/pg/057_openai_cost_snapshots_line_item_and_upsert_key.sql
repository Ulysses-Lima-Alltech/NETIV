ALTER TABLE openai_cost_snapshots
  ADD COLUMN IF NOT EXISTS line_item TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_openai_cost_snapshots_period_key_project_line
  ON openai_cost_snapshots (
    period_start,
    period_end,
    (COALESCE(openai_api_key_id, '')),
    (COALESCE(openai_project_id, '')),
    (COALESCE(line_item, ''))
  );
