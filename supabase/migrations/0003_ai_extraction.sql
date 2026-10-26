-- Mdaka Tender Intelligence — week 3: AI extraction results.
-- Run after 0002_ingestion.sql, in the Supabase SQL editor.
--
-- Once every PDF of a tender has been read, the tender is queued for AI extraction (first time
-- automatically; after that only when a person clicks "Re-run", to save model requests).
-- The worker claims it, runs extraction + verification + keyword safety net, then writes:
--   * tenders.ai_fields   — the tender-level facts (closing, briefing, submission...) with sources
--   * requirements rows   — one per document / disqualifier / special requirement, confirmed = false
-- Nothing is relied on until a person confirms it on the review screen (week 4).

create type public.ai_status as enum ('none', 'queued', 'running', 'done', 'failed');

alter type public.requirement_kind add value if not exists 'disqualifier';
alter type public.requirement_kind add value if not exists 'special';

alter table public.tenders
  add column ai_status public.ai_status not null default 'none',
  add column ai_error text,
  add column ai_attempts int not null default 0,
  add column ai_claimed_at timestamptz,
  add column ai_model text,
  add column ai_extracted_at timestamptz,
  add column ai_file_ids uuid[] not null default '{}',   -- files the last run read (to spot changes)
  add column ai_fields jsonb;                             -- verified tender-level fields + summary

create index tenders_ai_queue_idx on public.tenders (ai_claimed_at) where ai_status in ('queued', 'running');

alter table public.requirements
  add column quote text,
  add column conditions text,
  add column verified boolean,
  add column notes text[] not null default '{}',
  add column added_by text not null default 'user' check (added_by in ('ai', 'keyword_check', 'user')),
  add column sort_order int not null default 0;

-- ---------------------------------------------------------------- client write guard (tenders)
-- People edit tender details freely, but the AI columns belong to the worker. The one AI change a
-- person may make is asking for a (re-)run: ai_status -> 'queued' when nothing is running.
create function public._tenders_client_guard() returns trigger
language plpgsql set search_path = public
as $$
begin
  if current_user <> 'authenticated' then return new; end if;
  if tg_op = 'INSERT' then
    new.ai_status := 'none'; new.ai_error := null; new.ai_attempts := 0; new.ai_claimed_at := null;
    new.ai_model := null; new.ai_extracted_at := null; new.ai_file_ids := '{}'; new.ai_fields := null;
    return new;
  end if;
  if new.ai_status is distinct from old.ai_status then
    if not (new.ai_status = 'queued' and old.ai_status in ('none', 'done', 'failed')) then
      raise exception 'AI extraction is already queued or running.' using errcode = '42501';
    end if;
    new.ai_attempts := 0; new.ai_error := null;
  else
    new.ai_error := old.ai_error; new.ai_attempts := old.ai_attempts;
  end if;
  new.ai_claimed_at := old.ai_claimed_at; new.ai_model := old.ai_model; new.ai_extracted_at := old.ai_extracted_at;
  new.ai_file_ids := old.ai_file_ids; new.ai_fields := old.ai_fields;
  return new;
end $$;

create trigger tenders_client_guard
before insert or update on public.tenders
for each row execute function public._tenders_client_guard();

-- ---------------------------------------------------------------- auto-queue after reading
-- When the last pending file of a tender finishes and the tender has never been extracted,
-- queue it. Later changes don't re-run automatically (the page offers "Re-run").
create function public._queue_ai_when_files_ready() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.status not in ('done', 'failed') or old.status = new.status then return new; end if;
  update public.tenders t
     set ai_status = 'queued'
   where t.id = new.tender_id
     and t.ai_status = 'none'
     and exists (select 1 from public.tender_files f where f.tender_id = t.id and f.status = 'done')
     and not exists (select 1 from public.tender_files f where f.tender_id = t.id and f.status in ('queued', 'extracting'));
  return new;
end $$;

create trigger tender_files_queue_ai
after update of status on public.tender_files
for each row execute function public._queue_ai_when_files_ready();

-- ---------------------------------------------------------------- worker queue
-- Claims the oldest queued tender whose files are all read. A run stuck for 20 minutes is
-- claimed again; after 3 attempts it's marked failed.
create function public.claim_tender_ai()
returns table (id uuid, company_id uuid, ai_attempts int)
language plpgsql security definer set search_path = public
as $$
begin
  update public.tenders t
     set ai_status = 'failed', ai_error = 'Gave up after 3 attempts. Click Re-run to try again.'
   where t.ai_status = 'running' and t.ai_claimed_at < now() - interval '20 minutes' and t.ai_attempts >= 3;

  return query
  update public.tenders t
     set ai_status = 'running', ai_claimed_at = now(), ai_attempts = t.ai_attempts + 1, ai_error = null
   where t.id = (
     select q.id from public.tenders q
      where (q.ai_status = 'queued'
             or (q.ai_status = 'running' and q.ai_claimed_at < now() - interval '20 minutes' and q.ai_attempts < 3))
        and not exists (select 1 from public.tender_files f where f.tender_id = q.id and f.status in ('queued', 'extracting'))
      order by q.updated_at
      for update skip locked
      limit 1)
  returning t.id, t.company_id, t.ai_attempts;
end $$;

revoke execute on function public.claim_tender_ai() from public, anon, authenticated;
grant execute on function public.claim_tender_ai() to service_role;
