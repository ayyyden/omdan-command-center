-- ─── Plaid bank account connections ─────────────────────────────────────────
-- plaid_items holds the Plaid access_token — the equivalent of a password
-- that can read months of full bank transaction history. Unlike every other
-- table in this app, it gets NO RLS policies for `authenticated` at all —
-- only the service-role client (server-side, in gated API routes) can ever
-- read or write it. bank_accounts/bank_transactions hold balances and
-- transaction data (no credentials) and follow the app's normal open-RLS +
-- app-layer permission-check pattern (032_shared_rls.sql), gated to admin+
-- via the new bank:view/bank:manage permissions.

create table if not exists public.plaid_items (
  id                 uuid        primary key default gen_random_uuid(),
  created_by         uuid        references auth.users(id) on delete set null,
  item_id            text        not null unique,
  access_token       text        not null,
  institution_id     text,
  institution_name   text,
  status             text        not null default 'active' check (status in ('active', 'error', 'revoked')),
  error              text,
  cursor             text,
  last_synced_at     timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

alter table public.plaid_items enable row level security;
-- Deliberately no policies — service-role only. Do not add a select policy here.

create table if not exists public.bank_accounts (
  id                 uuid        primary key default gen_random_uuid(),
  plaid_item_id      uuid        not null references public.plaid_items(id) on delete cascade,
  plaid_account_id   text        not null unique,
  name               text        not null,
  official_name      text,
  type               text,
  subtype            text,
  mask               text,
  current_balance    numeric(12,2),
  available_balance  numeric(12,2),
  currency           text default 'USD',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists bank_accounts_plaid_item_id_idx on public.bank_accounts(plaid_item_id);

alter table public.bank_accounts enable row level security;
create policy "bank_accounts_select" on public.bank_accounts for select to authenticated using (true);
create policy "bank_accounts_insert" on public.bank_accounts for insert to authenticated with check (true);
create policy "bank_accounts_update" on public.bank_accounts for update to authenticated using (true) with check (true);
create policy "bank_accounts_delete" on public.bank_accounts for delete to authenticated using (true);

create table if not exists public.bank_transactions (
  id                     uuid        primary key default gen_random_uuid(),
  bank_account_id        uuid        not null references public.bank_accounts(id) on delete cascade,
  plaid_transaction_id   text        not null unique,
  amount                 numeric(12,2) not null,
  -- Plaid convention: positive = money OUT (expense-like), negative = money IN (payment-like).
  date                   date        not null,
  name                   text        not null,
  merchant_name          text,
  category               text,
  pending                boolean     not null default false,
  match_status           text        not null default 'unmatched' check (match_status in ('unmatched', 'suggested', 'confirmed', 'ignored')),
  matched_expense_id     uuid        references public.expenses(id) on delete set null,
  matched_payment_id     uuid        references public.payments(id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists bank_transactions_account_id_idx on public.bank_transactions(bank_account_id);
create index if not exists bank_transactions_date_idx on public.bank_transactions(date);
create index if not exists bank_transactions_match_status_idx on public.bank_transactions(match_status);

alter table public.bank_transactions enable row level security;
create policy "bank_transactions_select" on public.bank_transactions for select to authenticated using (true);
create policy "bank_transactions_insert" on public.bank_transactions for insert to authenticated with check (true);
create policy "bank_transactions_update" on public.bank_transactions for update to authenticated using (true) with check (true);
create policy "bank_transactions_delete" on public.bank_transactions for delete to authenticated using (true);

drop trigger if exists bank_accounts_updated_at on public.bank_accounts;
create trigger bank_accounts_updated_at before update on public.bank_accounts
  for each row execute function public.handle_updated_at();

drop trigger if exists bank_transactions_updated_at on public.bank_transactions;
create trigger bank_transactions_updated_at before update on public.bank_transactions
  for each row execute function public.handle_updated_at();

drop trigger if exists plaid_items_updated_at on public.plaid_items;
create trigger plaid_items_updated_at before update on public.plaid_items
  for each row execute function public.handle_updated_at();
