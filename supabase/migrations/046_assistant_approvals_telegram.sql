-- Add 'telegram' to assistant_approvals channel constraint
-- and add requested_by_external for a channel-agnostic sender identifier.

alter table public.assistant_approvals
  drop constraint if exists assistant_approvals_channel_check;

alter table public.assistant_approvals
  add constraint assistant_approvals_channel_check
    check (channel in ('whatsapp', 'telegram', 'crm'));

-- Generic external sender identity (e.g. "telegram:424784681", "whatsapp:15551234567")
-- keeps requested_by_whatsapp for backward compatibility
alter table public.assistant_approvals
  add column if not exists requested_by_external text;
