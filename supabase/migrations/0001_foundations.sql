-- Mdaka Tender Intelligence — week 1 foundations (Supabase, Postgres 15+).
-- Run once in the Supabase SQL editor (or `supabase db push`).
--
-- Security model
--  * Multi-tenant: every row carries company_id. RLS limits every table to the caller's
--    own company, via public.my_company_id().
--  * company_id defaults to the caller's company, so the app never sends it. Child tables
--    use composite foreign keys (tender_id, company_id) so a row can never point at
--    another company's tender or document, even through a forged request.
--  * Storage: two private buckets (vault, tenders). Object paths start with the company id,
--    and storage policies check that first folder. Files are only ever read via signed URLs.
--  * Onboarding: a signed-in person with no company calls create_company(), which creates
--    the company and links them to it in one step.

-- ================================================================ enums
create type public.doc_type as enum (
  'tax_compliance',      -- SARS tax compliance status (TCS PIN)
  'csd_report',          -- National Treasury CSD registration report
  'bbbee',               -- B-BBEE certificate or sworn affidavit
  'cipc_registration',   -- CIPC company registration (CoR 14.3 etc.)
  'director_ids',        -- certified ID copies of directors
  'bank_letter',         -- bank confirmation letter
  'coid',                -- COID letter of good standing
  'other'
);
create type public.tender_status as enum ('reviewing', 'preparing', 'submitted', 'won', 'lost', 'not_bidding');
create type public.requirement_kind as enum ('document', 'form', 'briefing', 'deadline', 'certification', 'pricing', 'other');
create type public.confidence as enum ('high', 'medium', 'low');
create type public.requirement_status as enum ('todo', 'done', 'not_applicable');
create type public.match_state as enum ('ready', 'missing', 'expired');
create type public.reminder_kind as enum ('briefing', 'closing', 'query_deadline', 'doc_expiry');

-- ================================================================ companies + users
create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 200),
  csd_supplier_no text check (csd_supplier_no is null or csd_supplier_no ~ '^MAAA\d{7}$'),
  bbbee_level smallint check (bbbee_level between 1 and 8),  -- null = non-compliant / unknown
  created_at timestamptz not null default now()
);

-- One row per person; id = auth.users.id. v1 = one company per person.
create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  email text not null,
  name text not null,
  created_at timestamptz not null default now()
);
create index users_company_idx on public.users (company_id);

create function public.my_company_id() returns uuid
language sql stable security definer set search_path = public
as $$ select company_id from public.users where id = auth.uid() $$;

-- ================================================================ vault
create table public.company_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.my_company_id() references public.companies (id) on delete cascade,
  doc_type public.doc_type not null,
  label text,                               -- free text, required for 'other'
  file_path text not null,                  -- '<company_id>/<uuid>-<name>' in bucket 'vault'
  file_name text not null,
  file_size int check (file_size between 1 and 10485760),
  issued_on date,
  expires_on date,
  notes text,
  uploaded_by uuid default auth.uid() references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (id, company_id),
  check (doc_type <> 'other' or length(trim(coalesce(label, ''))) > 0),
  check (expires_on is null or issued_on is null or expires_on >= issued_on),
  check (split_part(file_path, '/', 1) = company_id::text)
);
create index company_documents_company_type_idx on public.company_documents (company_id, doc_type, created_at desc);

-- ================================================================ tenders
create table public.tenders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.my_company_id() references public.companies (id) on delete cascade,
  reference_no text,
  entity text,
  description text,
  closing_at timestamptz,
  briefing_at timestamptz,
  briefing_compulsory boolean,
  submission_method text,
  evaluation_method text,
  status public.tender_status not null default 'reviewing',
  created_by uuid default auth.uid() references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, company_id)
);
create index tenders_company_closing_idx on public.tenders (company_id, closing_at);

create table public.tender_files (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.my_company_id(),
  tender_id uuid not null,
  file_path text not null,                  -- '<company_id>/<tender_id>/<uuid>-<name>' in bucket 'tenders'
  file_name text not null,
  page_count int check (page_count > 0),
  ocr_used boolean not null default false,
  extracted_text jsonb,                     -- [{ "page": 1, "text": "..." }, ...], filled by the worker
  extracted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, company_id),
  foreign key (tender_id, company_id) references public.tenders (id, company_id) on delete cascade,
  check (split_part(file_path, '/', 1) = company_id::text)
);
create index tender_files_tender_idx on public.tender_files (tender_id);

-- ================================================================ checklist
create table public.requirements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.my_company_id(),
  tender_id uuid not null,
  kind public.requirement_kind not null,
  description text not null,
  doc_type public.doc_type,                 -- set when a vault document can satisfy it
  mandatory boolean not null default true,
  source_file_id uuid,
  source_page int check (source_page > 0),
  confidence public.confidence,             -- null = entered by hand
  confirmed boolean not null default false, -- nothing is relied on until a person confirms it
  status public.requirement_status not null default 'todo',
  created_at timestamptz not null default now(),
  unique (id, company_id),
  foreign key (tender_id, company_id) references public.tenders (id, company_id) on delete cascade,
  foreign key (source_file_id, company_id) references public.tender_files (id, company_id) on delete set null (source_file_id)
);
create index requirements_tender_idx on public.requirements (tender_id);

create table public.requirement_matches (
  requirement_id uuid primary key,
  company_id uuid not null default public.my_company_id(),
  company_document_id uuid,
  match_state public.match_state not null,
  updated_at timestamptz not null default now(),
  foreign key (requirement_id, company_id) references public.requirements (id, company_id) on delete cascade,
  -- If the matched vault document is deleted the link clears; the matcher (week 4) re-runs and
  -- sets match_state again.
  foreign key (company_document_id, company_id) references public.company_documents (id, company_id) on delete set null (company_document_id)
);

-- ================================================================ reminders
create table public.reminders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.my_company_id(),
  kind public.reminder_kind not null,
  tender_id uuid,
  document_id uuid,
  remind_at timestamptz not null,
  channel text not null default 'email' check (channel in ('email')),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  check (num_nonnulls(tender_id, document_id) = 1),
  foreign key (tender_id, company_id) references public.tenders (id, company_id) on delete cascade,
  foreign key (document_id, company_id) references public.company_documents (id, company_id) on delete cascade
);
create index reminders_due_idx on public.reminders (remind_at) where sent_at is null;

-- Expiry reminders follow the vault: 30, 7 and 1 day(s) before a document expires (future dates only).
-- The email sender arrives in week 5; the rows are ready for it.
create function public._sync_doc_expiry_reminders() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  delete from public.reminders where document_id = new.id and sent_at is null;
  if new.expires_on is not null then
    insert into public.reminders (company_id, kind, document_id, remind_at)
    select new.company_id, 'doc_expiry', new.id, d at time zone 'Africa/Johannesburg'
    from (values ((new.expires_on - 30)::timestamp + time '08:00'),
                 ((new.expires_on - 7)::timestamp + time '08:00'),
                 ((new.expires_on - 1)::timestamp + time '08:00')) v(d)
    where (d at time zone 'Africa/Johannesburg') > now();
  end if;
  return new;
end $$;

create trigger company_documents_reminders
after insert or update of expires_on on public.company_documents
for each row execute function public._sync_doc_expiry_reminders();

create function public._touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
create trigger tenders_touch before update on public.tenders for each row execute function public._touch_updated_at();
create trigger requirement_matches_touch before update on public.requirement_matches for each row execute function public._touch_updated_at();

-- ================================================================ onboarding
create function public.create_company(p_name text, p_person_name text, p_csd text default null, p_bbbee int default null)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_company uuid;
  v_email text;
begin
  if length(trim(coalesce(p_person_name, ''))) = 0 then raise exception 'Enter your name.' using errcode = '22023'; end if;
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if exists (select 1 from public.users where id = auth.uid()) then
    raise exception 'You already belong to a company.' using errcode = 'P0001';
  end if;
  select email into v_email from auth.users where id = auth.uid();
  insert into public.companies (name, csd_supplier_no, bbbee_level)
  values (trim(p_name), nullif(upper(trim(p_csd)), ''), p_bbbee)
  returning id into v_company;
  insert into public.users (id, company_id, email, name)
  values (auth.uid(), v_company, coalesce(v_email, ''), trim(p_person_name));
  return v_company;
end $$;

-- ================================================================ privileges + RLS
revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from public, anon;
grant execute on function public.my_company_id(), public.create_company(text, text, text, int) to authenticated;

grant select on public.users to authenticated;
grant update (name) on public.users to authenticated;
grant select on public.companies to authenticated;
grant update (name, csd_supplier_no, bbbee_level) on public.companies to authenticated;
grant select, insert, update, delete on
  public.company_documents, public.tenders, public.tender_files,
  public.requirements, public.requirement_matches, public.reminders
to authenticated;
-- The client never needs to send company_id: it defaults to the caller's company, and the
-- RLS "with check" below rejects any row (insert or update) that names a different company.

alter table public.companies enable row level security;
alter table public.users enable row level security;
alter table public.company_documents enable row level security;
alter table public.tenders enable row level security;
alter table public.tender_files enable row level security;
alter table public.requirements enable row level security;
alter table public.requirement_matches enable row level security;
alter table public.reminders enable row level security;

create policy companies_own on public.companies for select to authenticated using (id = public.my_company_id());
create policy companies_update on public.companies for update to authenticated
  using (id = public.my_company_id()) with check (id = public.my_company_id());

create policy users_same_company on public.users for select to authenticated using (company_id = public.my_company_id());
create policy users_update_self on public.users for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Same rule on every company-owned table.
do $$
declare t text;
begin
  foreach t in array array['company_documents', 'tenders', 'tender_files', 'requirements', 'requirement_matches', 'reminders'] loop
    execute format(
      'create policy %1$s_company on public.%1$I for all to authenticated
         using (company_id = public.my_company_id())
         with check (company_id = public.my_company_id())', t);
  end loop;
end $$;

-- ================================================================ storage
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('vault', 'vault', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png']),
  ('tenders', 'tenders', false, 52428800, array['application/pdf'])
on conflict (id) do nothing;

create policy storage_company_read on storage.objects for select to authenticated
  using (bucket_id in ('vault', 'tenders') and (storage.foldername(name))[1] = public.my_company_id()::text);
create policy storage_company_insert on storage.objects for insert to authenticated
  with check (bucket_id in ('vault', 'tenders') and (storage.foldername(name))[1] = public.my_company_id()::text);
create policy storage_company_delete on storage.objects for delete to authenticated
  using (bucket_id in ('vault', 'tenders') and (storage.foldername(name))[1] = public.my_company_id()::text);
