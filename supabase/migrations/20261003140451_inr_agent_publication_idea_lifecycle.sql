-- Les textes restent dans les réglages V1 ; cette table porte uniquement leur
-- état et la réservation exclusive d'un créneau ou d'une génération en cours.
create table if not exists public.inr_agent_publication_ideas (
  user_id uuid not null,
  idea_text text not null,
  status text not null default 'active'
    check (status in ('active', 'disabled', 'used')),
  reserved_action_id uuid,
  used_action_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, idea_text),
  check (char_length(idea_text) between 1 and 500),
  check (status = 'active' or reserved_action_id is null)
);

create unique index if not exists inr_agent_publication_ideas_reservation_idx
  on public.inr_agent_publication_ideas (user_id, reserved_action_id)
  where reserved_action_id is not null;

alter table public.inr_agent_publication_ideas enable row level security;
revoke all on public.inr_agent_publication_ideas from anon, authenticated;
grant select, insert, update, delete on public.inr_agent_publication_ideas to service_role;

-- Reprendre les idées existantes sans modifier leur tableau de textes.
insert into public.inr_agent_publication_ideas (user_id, idea_text)
select distinct settings.user_id, left(btrim(idea.value), 500)
  from public.inr_agent_automation_settings as settings
 cross join lateral jsonb_array_elements_text(
   case when jsonb_typeof(settings.metadata -> 'publicationIdeas') = 'array'
     then settings.metadata -> 'publicationIdeas'
     else '[]'::jsonb end
 ) as idea(value)
 where settings.automation_key = 'publish'
   and btrim(idea.value) <> ''
on conflict do nothing;

-- Les anciennes actions déjà préparées ont réellement utilisé leur idée.
with generated as (
  select distinct on (action.user_id, btrim(coalesce(
      action.payload -> 'editorialFocus' ->> 'subject',
      action.payload -> 'editorialPlan' -> 'focus' ->> 'subject')))
    action.user_id,
    btrim(coalesce(action.payload -> 'editorialFocus' ->> 'subject',
      action.payload -> 'editorialPlan' -> 'focus' ->> 'subject')) as idea_text,
    action.id
  from public.inr_agent_actions as action
  where action.automation_key = 'publish'
    and coalesce(action.payload -> 'editorialFocus' ->> 'source',
      action.payload -> 'editorialPlan' -> 'focus' ->> 'source') = 'professional_idea'
    and exists (
      select 1
        from jsonb_each(case
          when jsonb_typeof(action.payload -> 'postByChannel') = 'object'
            and action.payload -> 'postByChannel' <> '{}'::jsonb
            then action.payload -> 'postByChannel'
          when jsonb_typeof(action.payload -> 'publishPayload' -> 'postByChannel') = 'object'
            then action.payload -> 'publishPayload' -> 'postByChannel'
          else '{}'::jsonb end) as post(channel, content)
       where btrim(coalesce(post.content ->> 'title', '') ||
         coalesce(post.content ->> 'content', '') ||
         coalesce(post.content ->> 'cta', '')) <> ''
    )
  order by action.user_id,
    btrim(coalesce(action.payload -> 'editorialFocus' ->> 'subject',
      action.payload -> 'editorialPlan' -> 'focus' ->> 'subject')),
    action.created_at desc
)
update public.inr_agent_publication_ideas as idea
   set status = 'used', used_action_id = generated.id, updated_at = now()
  from generated
 where idea.user_id = generated.user_id
   and idea.idea_text = generated.idea_text;

-- Un sujet déjà prévu reste indisponible avant sa date de génération.
with queued as (
  select distinct on (action.user_id, btrim(action.payload -> 'editorialPlan' -> 'focus' ->> 'subject'))
    action.user_id,
    btrim(action.payload -> 'editorialPlan' -> 'focus' ->> 'subject') as idea_text,
    action.id
  from public.inr_agent_actions as action
  where action.automation_key = 'publish'
    and action.status in ('draft', 'executing', 'failed')
    and action.payload -> 'editorialPlan' -> 'focus' ->> 'source' = 'professional_idea'
    and action.payload -> 'editorialPlan' ->> 'state' is distinct from 'ready'
  order by action.user_id,
    btrim(action.payload -> 'editorialPlan' -> 'focus' ->> 'subject'),
    action.scheduled_for asc
)
update public.inr_agent_publication_ideas as idea
   set reserved_action_id = queued.id, updated_at = now()
  from queued
 where idea.user_id = queued.user_id
   and idea.idea_text = queued.idea_text
   and idea.status = 'active';

-- Les anciennes actions failed n'ont pas généré de contenu. Libérer seulement
-- celles dont le budget de retries est épuisé ; les autres restent réservées.
update public.inr_agent_publication_ideas as idea
   set reserved_action_id = null, updated_at = now()
  from public.inr_agent_actions as action
 where idea.user_id = action.user_id
   and idea.reserved_action_id = action.id
   and idea.status = 'active'
   and action.status = 'failed'
   and action.metadata ->> 'editorialState' = 'failed'
   and action.metadata ->> 'editorialNextRetryAt' is null
   and case
     when coalesce(action.metadata ->> 'editorialAttempts', '') ~ '^[0-9]+$'
       then (action.metadata ->> 'editorialAttempts')::numeric
     else 0 end >= case
       when lower(coalesce(action.metadata ->> 'editorialRetryReason', '')) = 'quota'
         or lower(coalesce(action.metadata ->> 'editorialLastError', action.last_error, '')) ~
           '(quota|rate.?limit|too many requests|(^|[^0-9])429([^0-9]|$)|ai_gateway_account_limit_reached|limite|ai.{0,100}safety limit)'
         then 12 else 8 end;

-- L'action et la consommation de l'idée sont validées ou annulées ensemble.
-- Un statut désactivé, déjà utilisé ou réservé ailleurs refuse la génération.
create or replace function public.inrcy_consume_inr_agent_publication_idea()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_focus jsonb;
  v_idea text;
begin
  if tg_op = 'DELETE' then
    update public.inr_agent_publication_ideas
       set reserved_action_id = null, updated_at = now()
     where user_id = old.user_id
       and reserved_action_id = old.id
       and status = 'active';
    return old;
  end if;

  if new.status = 'cancelled' then
    update public.inr_agent_publication_ideas
       set reserved_action_id = null, updated_at = now()
     where user_id = new.user_id
       and reserved_action_id = new.id
       and status = 'active';
    return new;
  end if;

  if new.status = 'failed'
    and new.metadata ->> 'editorialState' = 'failed'
    and new.metadata ->> 'editorialNextRetryAt' is null
    and new.metadata ->> 'editorialIdeaReservationTerminal' = 'true' then
    update public.inr_agent_publication_ideas
       set reserved_action_id = null, updated_at = now()
     where user_id = new.user_id
       and reserved_action_id = new.id
       and status = 'active';
    return new;
  end if;

  if new.automation_key <> 'publish'
    or new.status not in ('pending_validation', 'prepared', 'pending') then
    return new;
  end if;

  v_focus := new.payload -> 'editorialFocus';
  if v_focus ->> 'source' <> 'professional_idea' then
    return new;
  end if;
  v_idea := btrim(v_focus ->> 'subject');
  if v_idea is null or v_idea = '' then
    return new;
  end if;
  if not exists (
    select 1 from jsonb_each(case
      when jsonb_typeof(new.payload -> 'postByChannel') = 'object'
        then new.payload -> 'postByChannel'
      else '{}'::jsonb end) as post(channel, content)
     where btrim(coalesce(post.content ->> 'title', '') ||
       coalesce(post.content ->> 'content', '') ||
       coalesce(post.content ->> 'cta', '')) <> ''
  ) then
    raise exception 'INR_AGENT_PUBLICATION_IDEA_NO_CONTENT' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE'
    and (
      old.metadata ->> 'editorialPreviouslyGeneratedIdea' = v_idea
      or (coalesce(old.payload -> 'editorialFocus' ->> 'subject',
          old.payload -> 'editorialPlan' -> 'focus' ->> 'subject') = v_idea
        and ((jsonb_typeof(old.payload -> 'postByChannel') = 'object'
            and old.payload -> 'postByChannel' <> '{}'::jsonb)
          or (jsonb_typeof(old.payload -> 'publishPayload' -> 'postByChannel') = 'object'
            and old.payload -> 'publishPayload' -> 'postByChannel' <> '{}'::jsonb)))
    ) then
    return new;
  end if;
  if not exists (
    select 1 from public.inr_agent_automation_settings as settings
     where settings.user_id = new.user_id
       and settings.automation_key = 'publish'
       and jsonb_typeof(settings.metadata -> 'publicationIdeas') = 'array'
       and (settings.metadata -> 'publicationIdeas') ? v_idea
  ) then
    raise exception 'INR_AGENT_PUBLICATION_IDEA_REMOVED' using errcode = 'P0001';
  end if;

  update public.inr_agent_publication_ideas
     set status = 'used',
         reserved_action_id = null,
         used_action_id = new.id,
         updated_at = now()
   where user_id = new.user_id
     and idea_text = v_idea
     and status = 'active'
     and (reserved_action_id is null or reserved_action_id = new.id);

  if not found and not exists (
    select 1 from public.inr_agent_publication_ideas
     where user_id = new.user_id
       and idea_text = v_idea
       and status = 'used'
       and used_action_id = new.id
  ) then
    raise exception 'INR_AGENT_PUBLICATION_IDEA_UNAVAILABLE' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function public.inrcy_consume_inr_agent_publication_idea() from public, anon, authenticated;
grant execute on function public.inrcy_consume_inr_agent_publication_idea() to service_role;

drop trigger if exists inrcy_consume_inr_agent_publication_idea on public.inr_agent_actions;
create trigger inrcy_consume_inr_agent_publication_idea
after insert or update of status, payload on public.inr_agent_actions
for each row execute function public.inrcy_consume_inr_agent_publication_idea();

drop trigger if exists inrcy_release_inr_agent_publication_idea on public.inr_agent_actions;
create trigger inrcy_release_inr_agent_publication_idea
after delete on public.inr_agent_actions
for each row execute function public.inrcy_consume_inr_agent_publication_idea();
