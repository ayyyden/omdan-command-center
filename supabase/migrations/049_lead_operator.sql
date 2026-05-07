-- Add lead_operator to the team_role enum
alter type public.team_role add value if not exists 'lead_operator';

-- Add caller_phone to team_members so the VA can receive Twilio bridge calls
alter table public.team_members
  add column if not exists caller_phone text;
