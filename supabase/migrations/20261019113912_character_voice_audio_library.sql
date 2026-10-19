-- Permit durable MP3/WAV entries alongside existing images and videos.
-- Ownership, storage paths, quotas and RLS keep their existing contracts.
-- No media_assets bridge appears in the tracked media-library SQL.
begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.pro_media_library
  drop constraint if exists pro_media_library_media_type_check;

alter table public.pro_media_library
  add constraint pro_media_library_media_type_check
  check (media_type in ('image', 'video', 'audio')) not valid;

alter table public.pro_media_library
  validate constraint pro_media_library_media_type_check;

commit;
