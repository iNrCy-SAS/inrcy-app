begin;

alter table public.business_profiles
  add column if not exists ai_liked_example_2 text not null default '';

update public.business_profiles
set ai_liked_example_2 = ''
where ai_liked_example_2 is null;

alter table public.business_profiles
  alter column ai_liked_example_2 set default '',
  alter column ai_liked_example_2 set not null;

comment on column public.business_profiles.ai_liked_example_2 is
  'Second exemple de contenu apprécié, utilisé comme inspiration de style par l IA sans copie.';

do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'business_profiles'
      and column_name = 'ai_liked_example_2'
      and is_nullable = 'NO'
      and column_default = $default$''::text$default$
  ) then
    raise exception 'Postflight failed: business_profiles.ai_liked_example_2 has an unexpected shape';
  end if;
end;
$$;

commit;
