begin;

alter table if exists public.inr_agent_automation_settings
  drop constraint if exists inr_agent_frequency_check;

alter table if exists public.inr_agent_automation_settings
  add constraint inr_agent_frequency_check
  check (
    frequency in (
      'weekly',
      'twice_weekly',
      'three_times_weekly',
      'biweekly',
      'three_times_monthly',
      'monthly',
      'quarterly',
      'one_off'
    )
  );

commit;
