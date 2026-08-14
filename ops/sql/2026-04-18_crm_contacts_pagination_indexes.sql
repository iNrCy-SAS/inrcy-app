-- iNrCRM — pagination/search performance
-- À lancer dans Supabase SQL Editor ou via votre workflow de migrations.

create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;

create index if not exists crm_contacts_user_created_at_idx
on public.crm_contacts (user_id, created_at desc);

create index if not exists crm_contacts_user_email_idx
on public.crm_contacts (user_id, lower(email));

create index if not exists crm_contacts_user_phone_idx
on public.crm_contacts (user_id, phone);

create index if not exists crm_contacts_user_postal_code_idx
on public.crm_contacts (user_id, postal_code);

create index if not exists crm_contacts_search_trgm_idx
on public.crm_contacts
using gin (
  (
    coalesce(last_name, '') || ' ' ||
    coalesce(first_name, '') || ' ' ||
    coalesce(company_name, '') || ' ' ||
    coalesce(email, '') || ' ' ||
    coalesce(phone, '') || ' ' ||
    coalesce(address, '') || ' ' ||
    coalesce(city, '') || ' ' ||
    coalesce(postal_code, '') || ' ' ||
    coalesce(siret, '') || ' ' ||
    coalesce(category::text, '') || ' ' ||
    coalesce(contact_type::text, '')
  ) gin_trgm_ops
);
