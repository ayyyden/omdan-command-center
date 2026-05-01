-- Lia assistant approval queue
-- Stores every action Lia requests human approval for before executing.

create table if not exists public.assistant_approvals (
  id                    uuid        primary key default gen_random_uuid(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  -- Who requested it (nullable: Lia/bridge may not have a Supabase session)
  requested_by          uuid        references auth.users(id) on delete set null,
  requested_by_whatsapp text,         -- E.164 WhatsApp number e.g. "15551234567"

  channel               text        not null check (channel in ('whatsapp', 'crm')),
  action_type           text        not null, -- e.g. "create_lead", "send_estimate", "schedule_job"
  action_summary        text        not null, -- human-readable one-liner shown in WhatsApp message

  proposed_payload      jsonb,       -- full structured data Lia would submit to CRM
  status                text        not null default 'pending'
                          check (status in ('pending', 'approved', 'rejected', 'edited', 'expired', 'executed', 'failed')),

  expires_at            timestamptz not null default (now() + interval '24 hours'),
  approved_at           timestamptz,
  rejected_at           timestamptz,
  executed_at           timestamptz,

  result                jsonb,       -- CRM response after execution
  error                 text,        -- error message if execution failed

  -- IDs of CRM records created/affected by this action
  related_record_ids    jsonb        -- e.g. { "lead_id": "...", "estimate_id": "..." }
);

alter table public.assistant_approvals enable row level security;

-- Authenticated team members can read all approvals (owner/admin gating done in API layer)
create policy "team_select_approvals" on public.assistant_approvals
  for select to authenticated using (true);

-- Authenticated users (CRM UI) can insert approvals
create policy "authenticated_insert_approvals" on public.assistant_approvals
  for insert to authenticated with check (true);

-- Authenticated users can update (for CRM-side approval handling)
create policy "authenticated_update_approvals" on public.assistant_approvals
  for update to authenticated using (true);

-- Fast lookup by status (used on every GET to find pending + auto-expire)
create index if not exists idx_assistant_approvals_status
  on public.assistant_approvals (status, expires_at);

create index if not exists idx_assistant_approvals_channel
  on public.assistant_approvals (channel, created_at desc);
