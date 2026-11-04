-- Estimate upgrade: estimate numbers, 15-day validity, the short note the
-- scope was written from, and the client's online signature.

create sequence if not exists public.estimate_number_seq start 1001;

alter table public.estimates
  add column if not exists estimate_number int,
  add column if not exists valid_until     date,
  add column if not exists brief           text,
  add column if not exists signer_name     text,
  add column if not exists signature_png   text,
  add column if not exists signed_at       timestamptz,
  add column if not exists signed_pdf_path text;

-- Number existing estimates in the order they were created, then every new one
update public.estimates e
   set estimate_number = n.num
  from (select id, 1000 + row_number() over (order by created_at, id) as num
          from public.estimates
         where estimate_number is null) n
 where e.id = n.id;

select setval('public.estimate_number_seq', greatest(1000, (select coalesce(max(estimate_number), 1000) from public.estimates)));

alter table public.estimates
  alter column estimate_number set default nextval('public.estimate_number_seq');

create unique index if not exists estimates_estimate_number_key on public.estimates (estimate_number);

grant usage, select on sequence public.estimate_number_seq to authenticated, service_role;
