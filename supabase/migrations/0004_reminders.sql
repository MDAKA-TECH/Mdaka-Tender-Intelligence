-- Mdaka Tender Intelligence — week 5: email reminders, activity log.
-- Run after 0003_ai_extraction.sql, in the Supabase SQL editor.
--
-- Reminders
--  * Rows are created and kept in step by triggers only; the app can read them but not write them.
--      closing   08:00 SAST, 7 and 2 days before, and on the closing day
--      briefing  08:00 SAST, 2 days before and on the day (skipped when marked optional)
--      expiry    08:00 SAST, 30, 7 and 1 day(s) before a vault document expires (since week 1)
--    A reminder that would land less than an hour before the event moves to 08:00 the day before.
--  * Only tenders that are Reviewing or Preparing get reminders. Marking a tender Submitted, Won,
--    Lost or Not bidding removes its unsent ones.
--  * The send-reminders Edge Function (supabase/functions) runs hourly. It calls
--    claim_due_reminders(), emails one digest per company with Resend, then finish_reminders().
--
-- Activity log
--  * What a person did (confirmed, ticked, edited, deleted an item; changed a tender's status or
--    dates) is logged by triggers. Worker and AI changes are not logged. The log is read-only.

-- ================================================================ settings
alter table public.users add column email_reminders boolean not null default true;
grant update (name, email_reminders) on public.users to authenticated;

-- ================================================================ reminder bookkeeping
alter table public.reminders
  add column claimed_at timestamptz,
  add column attempts int not null default 0,
  add column last_error text,
  add column outcome text check (outcome in ('sent', 'skipped', 'failed'));

create index reminders_tender_idx on public.reminders (tender_id) where tender_id is not null;
create index reminders_document_idx on public.reminders (document_id) where document_id is not null;

-- Reminders are system-managed: people can see them, only triggers and the sender change them.
revoke insert, update, delete on public.reminders from authenticated;

-- 08:00 SAST on the day `days` before `event_at`; if that's under an hour before the event, 08:00 the
-- day before that. Returns null for a time already past.
create function public._reminder_time(event_at timestamptz, days int) returns timestamptz
language plpgsql stable set search_path = public
as $$
declare
  local_day date := (event_at at time zone 'Africa/Johannesburg')::date - days;
  t timestamptz := (local_day + time '08:00') at time zone 'Africa/Johannesburg';
begin
  if t > event_at - interval '1 hour' then
    t := ((local_day - 1) + time '08:00') at time zone 'Africa/Johannesburg';
  end if;
  return t;
end $$;

create function public._sync_tender_reminders() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  delete from public.reminders where tender_id = new.id and sent_at is null;
  if new.status not in ('reviewing', 'preparing') then return new; end if;

  if new.closing_at is not null then
    insert into public.reminders (company_id, kind, tender_id, remind_at)
    select distinct new.company_id, 'closing'::public.reminder_kind, new.id, public._reminder_time(new.closing_at, d)
    from unnest(array[7, 2, 0]) d
    where public._reminder_time(new.closing_at, d) > now();
  end if;

  if new.briefing_at is not null and new.briefing_compulsory is distinct from false then
    insert into public.reminders (company_id, kind, tender_id, remind_at)
    select distinct new.company_id, 'briefing'::public.reminder_kind, new.id, public._reminder_time(new.briefing_at, d)
    from unnest(array[2, 0]) d
    where public._reminder_time(new.briefing_at, d) > now();
  end if;
  return new;
end $$;

create trigger tenders_reminders
after insert or update of closing_at, briefing_at, briefing_compulsory, status on public.tenders
for each row execute function public._sync_tender_reminders();

-- Tenders that existed before this migration.
update public.tenders set status = status;

-- ================================================================ sender (service_role only)
-- Claims every due reminder, skips the ones that no longer make sense, and returns one JSON object
-- per company with the recipients and the items to put in the email.
create function public.claim_due_reminders(p_limit int default 200) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  ids uuid[];
  result jsonb;
begin
  -- Give up on rows that failed 3 times.
  update public.reminders set sent_at = now(), outcome = 'failed'
   where sent_at is null and attempts >= 3;

  -- Skip what is stale: the event has passed, the reminder is more than a day late, the tender is
  -- no longer active, or a newer copy of the vault document has replaced the expiring one.
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

  -- Companies where nobody wants emails: mark their due reminders skipped too.
  update public.reminders r set sent_at = now(), outcome = 'skipped', last_error = 'Email reminders are off'
   where r.sent_at is null and r.remind_at <= now()
     and not exists (select 1 from public.users u where u.company_id = r.company_id and u.email_reminders and u.email <> '');

  -- Two reminders for the same event in one run (e.g. after downtime): keep the latest.
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
      'recipients', (select coalesce(jsonb_agg(jsonb_build_object('email', u.email, 'name', u.name)), '[]'::jsonb)
                       from public.users u where u.company_id = c.id and u.email_reminders and u.email <> ''),
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

-- After an email: p_error null = sent; otherwise the rows are retried next run (3 attempts).
create function public.finish_reminders(p_ids uuid[], p_error text default null) returns void
language sql security definer set search_path = public
as $$
  update public.reminders
     set sent_at = case when p_error is null then now() end,
         outcome = case when p_error is null then 'sent' end,
         last_error = left(p_error, 500),
         claimed_at = null
   where id = any(p_ids) and sent_at is null;
$$;

revoke execute on function public.claim_due_reminders(int), public.finish_reminders(uuid[], text) from public, anon, authenticated;
grant execute on function public.claim_due_reminders(int), public.finish_reminders(uuid[], text) to service_role;
revoke execute on function public._reminder_time(timestamptz, int) from public, anon;

-- ================================================================ activity log
create table public.audit_log (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies (id) on delete cascade,
  tender_id uuid,                            -- no foreign key: the history outlives a deleted item
  user_id uuid references public.users (id) on delete set null,
  action text not null,                      -- confirmed, edited, added, ticked, unticked, not_required, restored, deleted, status, dates
  subject text,                              -- requirement description or a short summary
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index audit_log_tender_idx on public.audit_log (tender_id, created_at desc);

alter table public.audit_log enable row level security;
grant select on public.audit_log to authenticated;
create policy audit_log_company on public.audit_log for select to authenticated using (company_id = public.my_company_id());

create function public._audit(p_company uuid, p_tender uuid, p_action text, p_subject text, p_details jsonb default '{}')
returns void language sql security definer set search_path = public
as $$
  insert into public.audit_log (company_id, tender_id, user_id, action, subject, details)
  values (p_company, p_tender, auth.uid(), p_action, left(p_subject, 300), p_details);
$$;
revoke execute on function public._audit(uuid, uuid, text, text, jsonb) from public, anon, authenticated;

create function public._audit_requirements() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  changed jsonb := '{}';
begin
  -- Triggers run as the table owner, so check who made the request, not current_user.
  if coalesce(auth.role(), '') <> 'authenticated' then return coalesce(new, old); end if;
  if tg_op = 'INSERT' then
    perform public._audit(new.company_id, new.tender_id, 'added', new.description);
  elsif tg_op = 'DELETE' then
    perform public._audit(old.company_id, old.tender_id, 'deleted', old.description);
  else
    if new.description is distinct from old.description then changed := changed || jsonb_build_object('description', old.description); end if;
    if new.doc_type is distinct from old.doc_type then changed := changed || jsonb_build_object('doc_type', old.doc_type); end if;
    if new.mandatory is distinct from old.mandatory then changed := changed || jsonb_build_object('mandatory', old.mandatory); end if;
    if new.conditions is distinct from old.conditions then changed := changed || jsonb_build_object('conditions', old.conditions); end if;
    if new.kind is distinct from old.kind then changed := changed || jsonb_build_object('kind', old.kind); end if;

    if new.status = 'not_applicable' and old.status <> 'not_applicable' then
      perform public._audit(new.company_id, new.tender_id, 'not_required', new.description);
    elsif old.status = 'not_applicable' and new.status <> 'not_applicable' then
      perform public._audit(new.company_id, new.tender_id, 'restored', new.description);
    elsif new.confirmed and not old.confirmed then
      perform public._audit(new.company_id, new.tender_id, case when changed = '{}' then 'confirmed' else 'edited' end, new.description, changed);
    elsif changed <> '{}' then
      perform public._audit(new.company_id, new.tender_id, 'edited', new.description, changed);
    elsif new.status = 'done' and old.status = 'todo' then
      perform public._audit(new.company_id, new.tender_id, 'ticked', new.description);
    elsif new.status = 'todo' and old.status = 'done' then
      perform public._audit(new.company_id, new.tender_id, 'unticked', new.description);
    end if;
  end if;
  return coalesce(new, old);
end $$;

create trigger requirements_audit
after insert or update or delete on public.requirements
for each row execute function public._audit_requirements();

create function public._audit_tenders() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  changed jsonb := '{}';
begin
  if coalesce(auth.role(), '') <> 'authenticated' then return new; end if;
  if tg_op = 'INSERT' then
    perform public._audit(new.company_id, new.id, 'created', coalesce(new.reference_no, 'Untitled tender'));
    return new;
  end if;
  if new.status is distinct from old.status then
    perform public._audit(new.company_id, new.id, 'status', coalesce(new.reference_no, 'Untitled tender'),
                          jsonb_build_object('from', old.status, 'to', new.status));
  end if;
  if new.closing_at is distinct from old.closing_at then changed := changed || jsonb_build_object('closing_at', jsonb_build_array(old.closing_at, new.closing_at)); end if;
  if new.briefing_at is distinct from old.briefing_at then changed := changed || jsonb_build_object('briefing_at', jsonb_build_array(old.briefing_at, new.briefing_at)); end if;
  if new.briefing_compulsory is distinct from old.briefing_compulsory then changed := changed || jsonb_build_object('briefing_compulsory', jsonb_build_array(old.briefing_compulsory, new.briefing_compulsory)); end if;
  if new.reference_no is distinct from old.reference_no or new.entity is distinct from old.entity
     or new.description is distinct from old.description then
    changed := changed || jsonb_build_object('details', true);
  end if;
  if changed <> '{}' then
    perform public._audit(new.company_id, new.id, 'details', coalesce(new.reference_no, 'Untitled tender'), changed);
  end if;
  return new;
end $$;

create trigger tenders_audit
after insert or update of status, closing_at, briefing_at, briefing_compulsory, reference_no, entity, description on public.tenders
for each row execute function public._audit_tenders();
