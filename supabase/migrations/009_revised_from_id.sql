-- Track which estimate a revision was created from
ALTER TABLE estimates
  ADD COLUMN IF NOT EXISTS revised_from_id uuid REFERENCES estimates(id) ON DELETE SET NULL;
