-- Two rolling calendar months. Hide expired prose immediately; a separate,
-- authenticated server cron removes expired rows. No live deletion here.
begin;

alter policy inr_assistant_turns_select_private on public.inr_assistant_turns
using (actor_user_id = (select auth.uid())
  and public.inrcy_can_access_account(account_id)
  and created_at >= (((now() at time zone 'UTC') - interval '2 months') at time zone 'UTC'));

alter policy inr_assistant_turns_update_private on public.inr_assistant_turns
using (actor_user_id = (select auth.uid())
  and public.inrcy_can_access_account(account_id)
  and created_at >= (((now() at time zone 'UTC') - interval '2 months') at time zone 'UTC'))
with check (actor_user_id = (select auth.uid())
  and public.inrcy_can_access_account(account_id)
  and created_at >= (((now() at time zone 'UTC') - interval '2 months') at time zone 'UTC'));

create index if not exists inr_assistant_turns_retention_idx
  on public.inr_assistant_turns(created_at);

-- Keep the cutoff explicit even for a privileged caller. Invoker rights and
-- account+actor membership checks continue to apply to authenticated readers.
create or replace function public.inrcy_list_assistant_conversations(p_account_id uuid,p_limit integer default 20)
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
        and first_turn.created_at >= (((now() at time zone 'UTC') - interval '2 months') at time zone 'UTC')
      order by first_turn.created_at,first_turn.turn_id limit 1) as title,
    c.updated_at
  from (
    select t.conversation_id,max(t.updated_at) as updated_at
    from public.inr_assistant_turns t
    where t.account_id = p_account_id
      and t.actor_user_id = (select auth.uid())
      and public.inrcy_can_access_account(p_account_id)
      and t.created_at >= (((now() at time zone 'UTC') - interval '2 months') at time zone 'UTC')
    group by t.conversation_id
  ) c
  order by c.updated_at desc,c.conversation_id
  limit least(greatest(coalesce(p_limit,20),1),21)
$$;
revoke all on function public.inrcy_list_assistant_conversations(uuid,integer) from public,anon;
grant execute on function public.inrcy_list_assistant_conversations(uuid,integer) to authenticated;

comment on table public.inr_assistant_turns is
  'iNrAssistant prose memory retained for two rolling calendar months, private to one authenticated professional and account; expired rows hidden by RLS then removed by a protected daily server cron.';
notify pgrst,'reload schema';
commit;
