begin;

-- Mirror of the production migration for manual recovery/audit runs.
insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'inrcy-ai-documents',
  'inrcy-ai-documents',
  false,
  20971520,
  array[
    'application/pdf',
    'application/x-pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/json',
    'application/octet-stream',
    'text/plain',
    'text/markdown',
    'text/csv',
    'text/html',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif'
  ]::text[]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

commit;
