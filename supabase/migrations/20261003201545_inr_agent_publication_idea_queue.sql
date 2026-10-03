-- L'ordre des idees est partage entre l'interface et les generations.
-- Une desactivation (manuelle ou apres generation reussie) envoie l'idee
-- en fin de file ; une reactivation conserve sa position courante.
create sequence if not exists public.inr_agent_publication_ideas_order_seq;

alter table public.inr_agent_publication_ideas
  add column if not exists order_key bigint;

do $$
declare
  v_idea record;
begin
  for v_idea in
    select idea.user_id, idea.idea_text
      from public.inr_agent_publication_ideas as idea
      left join lateral (
        select min(configured.ordinality) as position
          from public.inr_agent_automation_settings as settings
          cross join lateral jsonb_array_elements_text(
            case when jsonb_typeof(settings.metadata -> 'publicationIdeas') = 'array'
              then settings.metadata -> 'publicationIdeas'
              else '[]'::jsonb end
          ) with ordinality as configured(value, ordinality)
         where settings.user_id = idea.user_id
           and settings.automation_key = 'publish'
           and btrim(configured.value) = idea.idea_text
      ) as configured on true
     where idea.order_key is null
     order by idea.user_id,
       case when idea.status = 'active' then 0 else 1 end,
       configured.position nulls last,
       idea.updated_at,
       idea.idea_text
  loop
    update public.inr_agent_publication_ideas
       set order_key = nextval('public.inr_agent_publication_ideas_order_seq')
     where user_id = v_idea.user_id
       and idea_text = v_idea.idea_text;
  end loop;
end;
$$;

alter table public.inr_agent_publication_ideas
  alter column order_key set default nextval('public.inr_agent_publication_ideas_order_seq'),
  alter column order_key set not null;

alter sequence public.inr_agent_publication_ideas_order_seq
  owned by public.inr_agent_publication_ideas.order_key;

create index if not exists inr_agent_publication_ideas_order_idx
  on public.inr_agent_publication_ideas (user_id, order_key);

revoke all on sequence public.inr_agent_publication_ideas_order_seq from public, anon, authenticated;
grant usage, select on sequence public.inr_agent_publication_ideas_order_seq to service_role;

create or replace function public.inrcy_move_inr_agent_publication_idea_to_end()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.status is distinct from old.status
    and new.status in ('disabled', 'used') then
    new.order_key := nextval('public.inr_agent_publication_ideas_order_seq');
  end if;
  return new;
end;
$$;

revoke all on function public.inrcy_move_inr_agent_publication_idea_to_end()
  from public, anon, authenticated;
grant execute on function public.inrcy_move_inr_agent_publication_idea_to_end()
  to service_role;

drop trigger if exists inrcy_move_inr_agent_publication_idea_to_end
  on public.inr_agent_publication_ideas;
create trigger inrcy_move_inr_agent_publication_idea_to_end
before update of status on public.inr_agent_publication_ideas
for each row execute function public.inrcy_move_inr_agent_publication_idea_to_end();

-- Le depot manuel de l'ordre est atomique : pas de positions intermediaires
-- visibles pendant un glisser-deposer ou un clic sur une fleche.
create or replace function public.inrcy_reorder_inr_agent_publication_ideas(
  p_user_id uuid,
  p_idea_texts text[]
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_idea text;
  v_saved_ideas text[];
begin
  if p_user_id is null or p_idea_texts is null
    or cardinality(p_idea_texts) > 12 then
    raise exception 'INR_AGENT_IDEA_ORDER_INVALID' using errcode = '22023';
  end if;

  -- Verrouiller aussi les reglages : une sauvegarde concurrente ne doit pas
  -- modifier la liste pendant que l'ordre est applique.
  perform 1 from public.inr_agent_automation_settings
   where user_id = p_user_id and automation_key = 'publish'
   for update;

  select coalesce(array_agg(distinct btrim(configured.value)
    order by btrim(configured.value)), '{}'::text[])
    into v_saved_ideas
    from public.inr_agent_automation_settings as settings
    cross join lateral jsonb_array_elements_text(
      case when jsonb_typeof(settings.metadata -> 'publicationIdeas') = 'array'
        then settings.metadata -> 'publicationIdeas'
        else '[]'::jsonb end
    ) as configured(value)
   where settings.user_id = p_user_id
     and settings.automation_key = 'publish'
     and btrim(configured.value) <> '';

  if coalesce((select array_agg(requested.idea_text order by requested.idea_text)
    from unnest(p_idea_texts) as requested(idea_text)), '{}'::text[]) <> v_saved_ideas then
    raise exception 'INR_AGENT_IDEA_ORDER_STALE' using errcode = '22023';
  end if;

  perform 1 from public.inr_agent_publication_ideas
   where user_id = p_user_id and idea_text = any(p_idea_texts)
   order by order_key, idea_text
   for update;

  foreach v_idea in array p_idea_texts loop
    update public.inr_agent_publication_ideas
       set order_key = nextval('public.inr_agent_publication_ideas_order_seq'),
           updated_at = now()
     where user_id = p_user_id and idea_text = v_idea;
    if not found then
      raise exception 'INR_AGENT_IDEA_ORDER_STALE' using errcode = '22023';
    end if;
  end loop;
end;
$$;

revoke all on function public.inrcy_reorder_inr_agent_publication_ideas(uuid, text[])
  from public, anon, authenticated;
grant execute on function public.inrcy_reorder_inr_agent_publication_ideas(uuid, text[])
  to service_role;
