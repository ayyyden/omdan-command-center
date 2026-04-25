CREATE TABLE company_settings (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  company_name           text,
  license_number         text,
  phone                  text,
  email                  text,
  website                text,
  address                text,
  logo_url               text,
  default_payment_terms  text,
  default_estimate_notes text,
  default_invoice_notes  text,
  created_at             timestamptz DEFAULT now() NOT NULL,
  updated_at             timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE company_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own company settings"
  ON company_settings FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
