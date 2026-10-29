-- Mdaka Tender Intelligence: delete stored PDFs whenever their database row goes, however it goes.
-- Run after 0005_ai_errors.sql, in the Supabase SQL editor.
--
-- The app already removes the file straight after deleting a tender file or vault document. This is the
-- safety net for everything else:
--   * that removal failing (connection dropped, tab closed),
--   * deletes that cascade (deleting a tender, or a whole company/account, removes all its files),
--   * deletes run directly in SQL.
-- A trigger queues the storage path of every deleted row. The hourly send-reminders run removes the
-- queued files through the Storage API (Supabase doesn't allow deleting files from SQL) and clears the
-- queue. Removing a file that is already gone counts as done.

create table public.storage_cleanup (
  id bigint generated always as identity primary key,
  bucket text not null check (bucket in ('tenders', 'vault')),
  path text not null,
  queued_at timestamptz not null default now(),
  attempts int not null default 0,
  last_error text
);
alter table public.storage_cleanup enable row level security;   -- no policies: service role only
revoke all on public.storage_cleanup from anon, authenticated;

create function public._queue_storage_cleanup() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if old.file_path is not null then
    insert into public.storage_cleanup (bucket, path) values (tg_argv[0], old.file_path);
  end if;
  return old;
end $$;

create trigger tender_files_storage_cleanup
after delete on public.tender_files
for each row execute function public._queue_storage_cleanup('tenders');

create trigger company_documents_storage_cleanup
after delete on public.company_documents
for each row execute function public._queue_storage_cleanup('vault');

-- Next batch to remove (oldest first; gives up on a path after 5 failed attempts).
create function public.claim_storage_cleanup(p_limit int default 500) returns jsonb
language sql security definer set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'bucket', bucket, 'path', path) order by id), '[]'::jsonb)
  from (select id, bucket, path from public.storage_cleanup where attempts < 5 order by id limit p_limit) q;
$$;

-- Done: forget the rows. Failed: count the attempt and keep the error for the admin.
create function public.finish_storage_cleanup(p_done bigint[], p_failed bigint[] default '{}', p_error text default null) returns void
language sql security definer set search_path = public
as $$
  delete from public.storage_cleanup where id = any(p_done);
  update public.storage_cleanup set attempts = attempts + 1, last_error = left(p_error, 500) where id = any(p_failed);
$$;

revoke execute on function public._queue_storage_cleanup(), public.claim_storage_cleanup(int),
  public.finish_storage_cleanup(bigint[], bigint[], text) from public, anon, authenticated;
grant execute on function public.claim_storage_cleanup(int), public.finish_storage_cleanup(bigint[], bigint[], text) to service_role;

-- One-off: queue files already left behind by earlier deletes (stored files with no row pointing at them).
-- Files uploaded in the last hour are skipped, so an upload that is still being saved is never touched.
insert into public.storage_cleanup (bucket, path)
select o.bucket_id, o.name
from storage.objects o
where o.bucket_id in ('tenders', 'vault')
  and o.created_at < now() - interval '1 hour'
  and not exists (select 1 from public.tender_files f where f.file_path = o.name)
  and not exists (select 1 from public.company_documents d where d.file_path = o.name);
