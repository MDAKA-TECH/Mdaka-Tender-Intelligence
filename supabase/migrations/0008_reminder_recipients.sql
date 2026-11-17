-- Mdaka Tender Intelligence: who gets the reminder emails.
-- Run after 0007_word_questions_storage.sql, in the Supabase SQL editor.
--
-- Each company keeps up to 3 email addresses for reminders (Company profile → Email reminders).
-- They can be any address (a shared tenders@ inbox, a colleague without an account) and can be
-- edited to fix a typo. This replaces the per-person "email me reminders" switch from 0004.

create table public.reminder_recipients (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.my_company_id() references public.companies (id) on delete cascade,
  email text not null check (length(email) <= 254 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  name text check (name is null or length(name) <= 80),
  created_at timestamptz not null default now()
);
create unique index reminder_recipients_unique on public.reminder_recipients (company_id, lower(email));

alter table public.reminder_recipients enable row level security;
grant select, insert, delete on public.reminder_recipients to authenticated;
grant update (email, name) on public.reminder_recipients to authenticated;
create policy reminder_recipients_company on public.reminder_recipients for all to authenticated
  using (company_id = public.my_company_id()) with check (company_id = public.my_company_id());

-- Tidy what people type and keep the limit of 3 per company.
create function public._reminder_recipients_guard() returns trigger
language plpgsql set search_path = public
as $$
begin
  new.email := lower(trim(new.email));
  new.name := nullif(trim(coalesce(new.name, '')), '');
  if tg_op = 'UPDATE' then
    new.company_id := old.company_id;
  elsif (select count(*) from public.reminder_recipients r where r.company_id = new.company_id) >= 3 then
    raise exception 'Reminders can go to at most 3 email addresses. Remove one first.' using errcode = '23514';
  end if;
  return new;
end $$;

create trigger reminder_recipients_guard
before insert or update on public.reminder_recipients
for each row execute function public._reminder_recipients_guard();

-- A new account starts with its own sign-in email on the list.
create function public._seed_reminder_recipient() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.email <> '' and (select count(*) from public.reminder_recipients r where r.company_id = new.company_id) < 3 then
    insert into public.reminder_recipients (company_id, email, name)
    values (new.company_id, new.email, nullif(new.name, ''))
    on conflict do nothing;
  end if;
  return new;
end $$;

create trigger users_seed_reminder_recipient
after insert on public.users
for each row execute function public._seed_reminder_recipient();

revoke execute on function public._reminder_recipients_guard(), public._seed_reminder_recipient() from public, anon, authenticated;

-- One-off: everyone who had reminders switched on keeps getting them (first 3 per company).
insert into public.reminder_recipients (company_id, email, name)
select company_id, lower(trim(email)), nullif(name, '')
from (select u.*, row_number() over (partition by u.company_id order by u.created_at) n
        from public.users u
       where u.email_reminders and u.email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') x
where n <= 3
on conflict do nothing;

-- ================================================================ sender: same as 0004, recipients from the new list
create or replace function public.claim_due_reminders(p_limit int default 200) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  ids uuid[];
  result jsonb;
begin
  update public.reminders set sent_at = now(), outcome = 'failed'
   where sent_at is null and attempts >= 3;

  update public.reminders r set sent_at = now(), outcome = 'skipped', last_error = 'No longer relevant'
   where r.sent_at is null and r.remind_at <= now()
     and (r.remind_at < now() - interval '1 day'
          or exists (select 1 from public.tenders t where t.id = r.tender_id and (
                t.status not in ('reviewing', 'preparing')
             or (r.kind = 'closing' and (t.closing_at is null or t.closing_at <= now()))
             or (r.kind = 'briefing' and (t.briefing_at is null or t.briefing_at <= now()))))
          or exists (select 1 from public.company_documents d where d.id = r.document_id and (
                d.expires_on is null or d.expires_on < (now() at time zone 'Africa/Johannesburg')::date
             or exists (select 1 from public.company_documents n
                         where n.company_id = d.company_id and n.doc_type = d.doc_type
                           and coalesce(n.label, '') = coalesce(d.label, '')
                           and n.created_at > d.created_at))));

  -- Companies with no reminder addresses: mark their due reminders skipped.
  update public.reminders r set sent_at = now(), outcome = 'skipped', last_error = 'No reminder email addresses'
   where r.sent_at is null and r.remind_at <= now()
     and not exists (select 1 from public.reminder_recipients x where x.company_id = r.company_id);

  update public.reminders r set sent_at = now(), outcome = 'skipped', last_error = 'Superseded'
   where r.sent_at is null and r.remind_at <= now()
     and exists (select 1 from public.reminders o
                  where o.sent_at is null and o.remind_at <= now() and o.id <> r.id and o.kind = r.kind
                    and o.tender_id is not distinct from r.tender_id and o.document_id is not distinct from r.document_id
                    and (o.remind_at, o.id) > (r.remind_at, r.id));

  select array_agg(id) into ids from (
    select id from public.reminders
     where sent_at is null and remind_at <= now()
       and (claimed_at is null or claimed_at < now() - interval '15 minutes')
     order by remind_at
     limit p_limit
     for update skip locked) c;
  if ids is null then return '[]'::jsonb; end if;

  update public.reminders set claimed_at = now(), attempts = attempts + 1 where id = any(ids);

  select coalesce(jsonb_agg(g order by g->>'company_name'), '[]'::jsonb) into result from (
    select jsonb_build_object(
      'company_id', c.id,
      'company_name', c.name,
      'recipients', (select coalesce(jsonb_agg(jsonb_build_object('email', x.email, 'name', coalesce(x.name, '')) order by x.created_at), '[]'::jsonb)
                       from public.reminder_recipients x where x.company_id = c.id),
      'items', jsonb_agg(jsonb_build_object(
        'id', r.id, 'kind', r.kind, 'remind_at', r.remind_at,
        'tender', case when t.id is null then null else jsonb_build_object(
          'id', t.id, 'reference_no', t.reference_no, 'entity', t.entity, 'description', t.description,
          'closing_at', t.closing_at, 'briefing_at', t.briefing_at, 'briefing_compulsory', t.briefing_compulsory,
          'submission_method', t.submission_method, 'status', t.status,
          'open_items', (select count(*) from public.requirements q where q.tender_id = t.id and q.confirmed
                           and q.status = 'todo' and q.kind not in ('disqualifier', 'special')),
          'open_mandatory', (select count(*) from public.requirements q where q.tender_id = t.id and q.confirmed
                           and q.status = 'todo' and q.mandatory and q.kind not in ('disqualifier', 'special')),
          'to_review', (select count(*) from public.requirements q where q.tender_id = t.id and not q.confirmed)) end,
        'document', case when d.id is null then null else jsonb_build_object(
          'id', d.id, 'doc_type', d.doc_type, 'label', d.label, 'file_name', d.file_name, 'expires_on', d.expires_on) end
      ) order by r.remind_at)
    ) g
    from public.reminders r
    join public.companies c on c.id = r.company_id
    left join public.tenders t on t.id = r.tender_id
    left join public.company_documents d on d.id = r.document_id
    where r.id = any(ids)
    group by c.id, c.name
  ) x;
  return result;
end $$;
