CREATE TABLE message_templates (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name       text NOT NULL,
  type       text NOT NULL CHECK (type IN (
    'estimate_follow_up','job_scheduled','job_reminder',
    'payment_reminder','review_request','custom'
  )),
  subject    text,
  body       text NOT NULL DEFAULT '',
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE message_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own templates"
  ON message_templates FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX message_templates_user_id_idx ON message_templates(user_id);
CREATE INDEX message_templates_type_idx    ON message_templates(type);

CREATE TRIGGER on_message_templates_updated
  BEFORE UPDATE ON message_templates
  FOR EACH ROW EXECUTE PROCEDURE public.handle_updated_at();
