-- Fix notification_dismissals SELECT policy to be per-user
-- Each user should only see their own dismissals so dismissing
-- a notification for one user does not hide it for others.

drop policy if exists "notification_dismissals_select" on public.notification_dismissals;

create policy "notification_dismissals_select" on public.notification_dismissals
  for select to authenticated using (user_id = auth.uid());
