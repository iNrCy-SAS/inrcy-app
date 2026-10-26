-- Durable private conversation memory. No expiry job or retention TTL.
-- Reads and writes stay on the same authenticated professional AND account.
begin;

create table public.inr_assistant_turns (
  account_id uuid not null references public.inrcy_accounts(id) on delete cascade,
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null,
  turn_id uuid not null,
  lease_id uuid not null,
  user_text text not null check (char_length(user_text) between 1 and 4000),
  assistant_text text check (assistant_text is null or char_length(assistant_text) between 1 and 60000),
  status text not null default 'pending' check (status in ('pending','completed','failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search_document tsvector generated always as (
    to_tsvector('simple'::regconfig, user_text || ' ' || coalesce(assistant_text,''))
  ) stored,
  primary key (account_id,actor_user_id,turn_id),
  constraint inr_assistant_completed_reply_required check (status <> 'completed' or assistant_text is not null)
);

create index inr_assistant_turns_recent_idx
  on public.inr_assistant_turns(account_id,actor_user_id,created_at desc,turn_id desc);
create index inr_assistant_turns_conversation_idx
  on public.inr_assistant_turns(account_id,actor_user_id,conversation_id,created_at desc,turn_id desc);
create index inr_assistant_turns_search_idx on public.inr_assistant_turns using gin(search_document);

alter table public.inr_assistant_turns enable row level security;
revoke all on public.inr_assistant_turns from public,anon,authenticated;
grant select on public.inr_assistant_turns to authenticated;
grant insert(account_id,actor_user_id,conversation_id,turn_id,lease_id,user_text,status)
  on public.inr_assistant_turns to authenticated;
-- A turn's original question, identity and account cannot be rewritten.
grant update(assistant_text,status,lease_id,updated_at) on public.inr_assistant_turns to authenticated;
grant all on public.inr_assistant_turns to service_role;

create policy inr_assistant_turns_select_private on public.inr_assistant_turns
for select to authenticated
using (actor_user_id = (select auth.uid()) and public.inrcy_can_access_account(account_id));

create policy inr_assistant_turns_insert_private on public.inr_assistant_turns
for insert to authenticated
with check (actor_user_id = (select auth.uid()) and public.inrcy_can_access_account(account_id)
  and status = 'pending' and assistant_text is null);

create policy inr_assistant_turns_update_private on public.inr_assistant_turns
for update to authenticated
using (actor_user_id = (select auth.uid()) and public.inrcy_can_access_account(account_id))
with check (actor_user_id = (select auth.uid()) and public.inrcy_can_access_account(account_id));

create trigger inr_assistant_turns_touch_updated_at before update on public.inr_assistant_turns
for each row execute function public.inrcy_touch_updated_at();

-- Exact bounded conversation listing, not a lossy recent-row sample. Invoker
-- rights retain the same RLS even when called directly through the Data API.
create function public.inrcy_list_assistant_conversations(p_account_id uuid,p_limit integer default 20)
returns table(conversation_id uuid,title text,updated_at timestamptz)
language sql stable security invoker
set search_path = ''
set statement_timeout = '5s'
as $$
  select c.conversation_id,
    (select left(first_turn.user_text,100)
      from public.inr_assistant_turns first_turn
      where first_turn.account_id = p_account_id
        and first_turn.actor_user_id = (select auth.uid())
        and first_turn.conversation_id = c.conversation_id
      order by first_turn.created_at,first_turn.turn_id limit 1) as title,
    c.updated_at
  from (
    select t.conversation_id,max(t.updated_at) as updated_at
    from public.inr_assistant_turns t
    where t.account_id = p_account_id
      and t.actor_user_id = (select auth.uid())
      and public.inrcy_can_access_account(p_account_id)
    group by t.conversation_id
  ) c
  order by c.updated_at desc,c.conversation_id
  limit least(greatest(coalesce(p_limit,20),1),21)
$$;
revoke all on function public.inrcy_list_assistant_conversations(uuid,integer) from public,anon;
grant execute on function public.inrcy_list_assistant_conversations(uuid,integer) to authenticated;

comment on table public.inr_assistant_turns is
  'Durable iNrAssistant prose memory, private to one authenticated professional and account. No tool payloads, signed media URLs or expiring cache.';
notify pgrst,'reload schema';
commit;
