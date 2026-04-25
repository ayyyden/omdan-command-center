-- Link reminders directly to estimates
ALTER TABLE public.reminders
  ADD COLUMN IF NOT EXISTS estimate_id uuid REFERENCES public.estimates(id) ON DELETE CASCADE;

-- Add job_reminder type to the check constraint
ALTER TABLE public.reminders DROP CONSTRAINT IF EXISTS reminders_type_check;
ALTER TABLE public.reminders
  ADD CONSTRAINT reminders_type_check
  CHECK (type IN ('estimate_follow_up','payment_reminder','material_reminder','review_request','custom','job_reminder'));

CREATE INDEX IF NOT EXISTS reminders_estimate_id_idx ON public.reminders(estimate_id);
CREATE INDEX IF NOT EXISTS reminders_job_id_idx ON public.reminders(job_id);
