-- The "No Answer" outcome used to SELECT missed_call_count, add 1 in
-- JavaScript, then UPDATE — a classic lost-update race: two near-simultaneous
-- "No Answer" presses on the same lead (an eager double-tap with no
-- disabled/pending state on the button, or a retried request) both read the
-- same starting count and both write count+1, so one press silently doesn't
-- count. This makes the increment atomic at the database level regardless
-- of what races on the client.

create or replace function public.increment_meta_lead_missed_call(
  p_lead_id uuid,
  p_archive_threshold integer
)
returns public.meta_leads
language plpgsql
as $$
declare
  result public.meta_leads;
begin
  update public.meta_leads
  set missed_call_count = missed_call_count + 1,
      last_outcome = 'no_answer',
      list = case
        when missed_call_count + 1 >= p_archive_threshold then 'archive'
        else 'second_call_list'
      end
  where id = p_lead_id
  returning * into result;

  return result;
end;
$$;
