-- Mdaka Tender Intelligence: Word documents, questions about a tender, removing PDFs of closed tenders.
-- Run after 0006_storage_cleanup.sql, in the Supabase SQL editor.

-- ================================================================ Word documents
-- Tender files may now be Word documents (.docx, .doc). The worker converts each one to PDF (preview_path)
-- so it has real page numbers, can be read like any PDF, and can be shown with the quote highlighted.
update storage.buckets
   set allowed_mime_types = array[
     'application/pdf',
     'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
     'application/msword']
 where id = 'tenders';

alter table public.tender_files
  add column preview_path text,            -- PDF made by the worker from a Word file
  add column files_removed_at timestamptz; -- stored files deleted to save space; extracted text kept

-- Client guard from 0002, now also protecting the two worker-owned columns.
create or replace function public._tender_files_client_guard() returns trigger
language plpgsql set search_path = public
as $$
begin
  if current_user <> 'authenticated' then return new; end if;  -- worker / dashboard: no limits

  if tg_op = 'INSERT' then
    new.status := 'queued';
    new.error := null; new.attempts := 0; new.claimed_at := null;
    new.page_count := null; new.ocr_used := false; new.ocr_pages := '{}';
    new.extracted_text := null; new.extracted_at := null;
    new.preview_path := null; new.files_removed_at := null;
    return new;
  end if;

  -- UPDATE: the only change a person may make is "retry" (failed -> queued).
  if new.status is distinct from old.status then
    if not (old.status = 'failed' and new.status = 'queued' and old.files_removed_at is null) then
      raise exception 'Only a failed file can be retried.' using errcode = '42501';
    end if;
    new.attempts := 0;
    new.error := null;
  end if;
  new.claimed_at := old.claimed_at;
  new.page_count := old.page_count; new.ocr_used := old.ocr_used; new.ocr_pages := old.ocr_pages;
  new.extracted_text := old.extracted_text; new.extracted_at := old.extracted_at;
  new.file_path := old.file_path; new.tender_id := old.tender_id;
  new.preview_path := old.preview_path; new.files_removed_at := old.files_removed_at;
  if new.status = old.status then new.error := old.error; new.attempts := old.attempts; end if;
  return new;
end $$;

-- Deleting a file row also queues its PDF preview for removal (0006 queued only file_path).
create or replace function public._queue_storage_cleanup() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if old.file_path is not null then
    insert into public.storage_cleanup (bucket, path) values (tg_argv[0], old.file_path);
  end if;
  if tg_argv[0] = 'tenders' and old.preview_path is not null then
    insert into public.storage_cleanup (bucket, path) values ('tenders', old.preview_path);
  end if;
  return old;
end $$;

-- ================================================================ remove PDFs of a closed tender
-- Deletes a tender's stored files (the hourly run removes them from storage) but keeps the extracted text,
-- checklist, AI results and source page numbers. Only for tenders that are no longer active.
create function public.remove_tender_files(p_tender uuid) returns int
language plpgsql security definer set search_path = public
as $$
declare
  n int;
begin
  if not exists (select 1 from public.tenders t
                  where t.id = p_tender and t.company_id = public.my_company_id()
                    and t.status not in ('reviewing', 'preparing')) then
    raise exception 'Only a submitted, won, lost or not-bidding tender can have its files removed.' using errcode = '42501';
  end if;

  insert into public.storage_cleanup (bucket, path)
  select 'tenders', p from public.tender_files f,
         lateral unnest(array[f.file_path, f.preview_path]) p
   where f.tender_id = p_tender and f.files_removed_at is null and f.status = 'done' and p is not null;

  update public.tender_files set files_removed_at = now()
   where tender_id = p_tender and files_removed_at is null and status = 'done';
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function public.remove_tender_files(uuid) from public, anon;
grant execute on function public.remove_tender_files(uuid) to authenticated;

-- ================================================================ questions about a tender
-- A person asks a question; the worker answers it from the tender's text, with page references.
create type public.question_status as enum ('queued', 'answering', 'done', 'failed');

create table public.tender_questions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.my_company_id(),
  tender_id uuid not null,
  question text not null check (length(trim(question)) between 3 and 500),
  status public.question_status not null default 'queued',
  answer text,
  found boolean,
  citations jsonb not null default '[]',   -- [{file_id, page, quote, verified}]
  error text,
  error_kind text,
  model text,
  attempts int not null default 0,
  claimed_at timestamptz,
  asked_by uuid default auth.uid() references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  answered_at timestamptz,
  foreign key (tender_id, company_id) references public.tenders (id, company_id) on delete cascade
);
create index tender_questions_tender_idx on public.tender_questions (tender_id, created_at desc);
create index tender_questions_queue_idx on public.tender_questions (created_at) where status in ('queued', 'answering');

alter table public.tender_questions enable row level security;
grant select, insert, delete on public.tender_questions to authenticated;
create policy tender_questions_company on public.tender_questions for all to authenticated
  using (company_id = public.my_company_id()) with check (company_id = public.my_company_id());

-- People only ask; answers belong to the worker. Also a fair-use limit of 30 questions per company per hour.
create function public._tender_questions_client_guard() returns trigger
language plpgsql set search_path = public
as $$
begin
  if current_user <> 'authenticated' then return new; end if;
  new.status := 'queued'; new.answer := null; new.found := null; new.citations := '[]'; new.error := null;
  new.error_kind := null; new.model := null; new.attempts := 0; new.claimed_at := null; new.answered_at := null;
  new.asked_by := auth.uid(); new.question := trim(new.question);
  if (select count(*) from public.tender_questions q
       where q.company_id = new.company_id and q.created_at > now() - interval '1 hour') >= 30 then
    raise exception 'You have asked a lot of questions in the last hour. Try again a bit later.' using errcode = '54000';
  end if;
  return new;
end $$;

create trigger tender_questions_client_guard
before insert on public.tender_questions
for each row execute function public._tender_questions_client_guard();

-- Worker queue (service role only). A question stuck for 10 minutes is claimed again; 3 attempts at most.
create function public.claim_tender_question()
returns table (id uuid, company_id uuid, tender_id uuid, question text, attempts int)
language plpgsql security definer set search_path = public
as $$
begin
  update public.tender_questions q
     set status = 'failed', error = 'Gave up after 3 attempts.', error_kind = 'other'
   where q.status = 'answering' and q.claimed_at < now() - interval '10 minutes' and q.attempts >= 3;

  return query
  update public.tender_questions q
     set status = 'answering', claimed_at = now(), attempts = q.attempts + 1
   where q.id = (
     select x.id from public.tender_questions x
      where x.status = 'queued'
         or (x.status = 'answering' and x.claimed_at < now() - interval '10 minutes' and x.attempts < 3)
      order by x.created_at
      for update skip locked
      limit 1)
  returning q.id, q.company_id, q.tender_id, q.question, q.attempts;
end $$;

revoke execute on function public.claim_tender_question(), public._tender_questions_client_guard() from public, anon, authenticated;
grant execute on function public.claim_tender_question() to service_role;
