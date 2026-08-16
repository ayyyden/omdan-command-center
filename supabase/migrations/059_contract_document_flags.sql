-- Contracts/e-signature rebuild: document classification flags.
--
-- requires_signature: false = a send-only document with no fields and no
-- signature step (e.g. Contractor License, Project Warranty) — the Documents
-- page skips straight to email/attach with no fill form.
--
-- attached_to_template_id: set on a "back"/paired document that must always
-- travel with its "front" parent (e.g. Home Improvement Contract back page).
-- Any template with this set is hidden from the main Documents list and
-- auto-bundled whenever its parent is sent or signed.

alter table public.contract_templates
  add column if not exists requires_signature boolean not null default true;

alter table public.contract_templates
  add column if not exists attached_to_template_id uuid references public.contract_templates(id) on delete set null;

create index if not exists idx_contract_templates_attached_to
  on public.contract_templates (attached_to_template_id);

-- Consent capture (ESIGN/UETA disclosure screen) reuses the existing audit
-- log with a new action value, logged before the fill form is ever shown.
alter table public.approval_audit_logs
  drop constraint if exists approval_audit_logs_action_check;

alter table public.approval_audit_logs
  add constraint approval_audit_logs_action_check
  check (action in ('viewed', 'consented', 'signed', 'approved', 'declined'));
