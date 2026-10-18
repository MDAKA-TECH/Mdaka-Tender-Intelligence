-- Mdaka Tender Intelligence — week 2: PDF ingestion.
-- Run after 0001_foundations.sql, in the Supabase SQL editor.
--
-- Adds a processing state to tender_files. The browser uploads a PDF and inserts a 'queued'
-- row; the extraction worker (worker/, using the service_role key) claims rows one at a time,
-- reads the text page by page (OCR for scanned pages) and writes the result back.
-- The browser can never write the worker's columns: a trigger resets or keeps them.

create type public.extraction_status as enum ('queued', 'extracting', 'done', 'failed');

alter table public.tender_files
  add column file_size bigint check (file_size > 0),
  add column status public.extraction_status not null default 'queued',
  add column error text,
  add column attempts int not null default 0,
  add column claimed_at timestamptz,
  add column ocr_pages int[] not null default '{}';   -- 1-based page numbers that needed OCR

create index tender_files_queue_idx on public.tender_files (created_at) where status in ('queued', 'extracting');

-- ---------------------------------------------------------------- client write guard
create function public._tender_files_client_guard() returns trigger
language plpgsql set search_path = public
as $$
begin
  if current_user <> 'authenticated' then return new; end if;  -- worker / dashboard: no limits

  if tg_op = 'INSERT' then
    new.status := 'queued';
    new.error := null; new.attempts := 0; new.claimed_at := null;
    new.page_count := null; new.ocr_used := false; new.ocr_pages := '{}';
    new.extracted_text := null; new.extracted_at := null;
    return new;
  end if;

  -- UPDATE: the only change a person may make is "retry" (failed -> queued).
  if new.status is distinct from old.status then
    if not (old.status = 'failed' and new.status = 'queued') then
      raise exception 'Only a failed file can be retried.' using errcode = '42501';
    end if;
    new.attempts := 0;
    new.error := null;
  end if;
  new.claimed_at := old.claimed_at;
  new.page_count := old.page_count; new.ocr_used := old.ocr_used; new.ocr_pages := old.ocr_pages;
  new.extracted_text := old.extracted_text; new.extracted_at := old.extracted_at;
  new.file_path := old.file_path; new.tender_id := old.tender_id;
  if new.status = old.status then new.error := old.error; new.attempts := old.attempts; end if;
  return new;
end $$;

create trigger tender_files_client_guard
before insert or update on public.tender_files
for each row execute function public._tender_files_client_guard();

-- ---------------------------------------------------------------- worker queue
-- Claims the oldest waiting file. A file stuck in 'extracting' for 15 minutes (worker crashed)
-- is claimed again; after 3 attempts it is marked failed. Safe with several workers running.
create function public.claim_tender_file()
returns table (id uuid, company_id uuid, tender_id uuid, file_path text, file_name text, attempts int)
language plpgsql security definer set search_path = public
as $$
begin
  update public.tender_files f
     set status = 'failed', error = 'Gave up after 3 attempts. Retry, or upload the file again.'
   where f.status = 'extracting' and f.claimed_at < now() - interval '15 minutes' and f.attempts >= 3;

  return query
  update public.tender_files f
     set status = 'extracting', claimed_at = now(), attempts = f.attempts + 1, error = null
   where f.id = (
     select q.id from public.tender_files q
      where q.status = 'queued'
         or (q.status = 'extracting' and q.claimed_at < now() - interval '15 minutes' and q.attempts < 3)
      order by q.created_at
      for update skip locked
      limit 1)
  returning f.id, f.company_id, f.tender_id, f.file_path, f.file_name, f.attempts;
end $$;

revoke execute on function public.claim_tender_file() from public, anon, authenticated;
grant execute on function public.claim_tender_file() to service_role;
