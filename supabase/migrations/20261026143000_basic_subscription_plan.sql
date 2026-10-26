-- Commit the enum value before using it in subscription rows or functions.
alter type public.subscription_plan add value if not exists 'Basic';
