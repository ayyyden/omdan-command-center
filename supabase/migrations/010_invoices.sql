-- Invoices table for contractor billing
CREATE TABLE invoices (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  job_id      uuid REFERENCES jobs(id) ON DELETE CASCADE NOT NULL,
  customer_id uuid REFERENCES customers(id) ON DELETE CASCADE NOT NULL,
  type        text NOT NULL DEFAULT 'progress'
              CHECK (type IN ('deposit', 'progress', 'final')),
  status      text NOT NULL DEFAULT 'draft'
              CHECK (status IN ('draft', 'sent', 'partial', 'paid')),
  amount      numeric(10,2) NOT NULL DEFAULT 0,
  due_date    date,
  notes       text,
  created_at  timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own invoices"
  ON invoices FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX invoices_job_id_idx ON invoices(job_id);
CREATE INDEX invoices_user_id_idx ON invoices(user_id);

-- Link payments to invoices (optional — existing payments keep working)
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS invoice_id uuid REFERENCES invoices(id) ON DELETE SET NULL;
