-- ─── Lia CRM Chat ────────────────────────────────────────────────────────────
-- Adds conversation threads and messages for the in-CRM Lia chat interface.
-- The assistant_approvals table already exists (migrations 045/046).

-- 1. Conversation threads (one per chat session)
create table if not exists public.assistant_conversations (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users(id) on delete cascade,
  title      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists assistant_conversations_user_idx
  on public.assistant_conversations(user_id, created_at desc);

alter table public.assistant_conversations enable row level security;

drop policy if exists "conversations_own" on public.assistant_conversations;
create policy "conversations_own" on public.assistant_conversations
  for all to authenticated
  using  (user_id = auth.uid())
  with check (user_id = auth.uid());

-- 2. Messages within a conversation
create table if not exists public.assistant_messages (
  id              uuid        primary key default gen_random_uuid(),
  conversation_id uuid        not null references public.assistant_conversations(id) on delete cascade,
  role            text        not null check (role in ('user', 'assistant', 'system')),
  content         text        not null,
  action_id       uuid        references public.assistant_approvals(id) on delete set null,
  metadata        jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists assistant_messages_conv_idx
  on public.assistant_messages(conversation_id, created_at);

alter table public.assistant_messages enable row level security;

drop policy if exists "messages_own_conv" on public.assistant_messages;
create policy "messages_own_conv" on public.assistant_messages
  for all to authenticated
  using (
    exists (
      select 1 from public.assistant_conversations c
      where c.id = conversation_id and c.user_id = auth.uid()
    )
  );

-- 3. Link approvals to conversations (nullable — old approvals have no conversation)
alter table public.assistant_approvals
  add column if not exists conversation_id uuid
    references public.assistant_conversations(id) on delete set null;
