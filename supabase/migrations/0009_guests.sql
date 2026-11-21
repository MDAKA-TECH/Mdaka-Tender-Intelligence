-- Mdaka Tender Intelligence: try it before signing up.
-- Run after 0008_reminder_recipients.sql, in the Supabase SQL editor.
-- Also switch on in Supabase → Authentication → Sign In / Providers:
--   * "Allow anonymous sign-ins" (guests)
--   * "Allow manual linking" (a guest signing up with Google keeps their work)
--
-- A visitor can upload a tender and see the AI checklist without an account. Behind the scenes they
-- get a Supabase guest (anonymous) login and a placeholder company. When they sign up, the same login
-- becomes a normal account and keeps everything. Guests get one tender; no vault and no reminders.
-- Guest trials that never sign up are deleted after 7 days.

-- True for a guest login (Supabase puts is_anonymous in the token).
create function public.is_guest() returns boolean
language sql stable set search_path = public
as $$ select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) $$;

grant execute on function public.is_guest() to authenticated;

-- ================================================================ guest limits
create function public._guest_limits() returns trigger
language plpgsql set search_path = public
as $$
begin
  if current_user <> 'authenticated' or not public.is_guest() then return new; end if;

  if tg_table_name = 'tenders' then
    if exists (select 1 from public.tenders t where t.company_id = new.company_id) then
      raise exception 'Guests can try one tender. Sign up free to add more.' using errcode = 'P0001';
    end if;
  elsif tg_table_name = 'tender_files' then
    if (select count(*) from public.tender_files f where f.company_id = new.company_id) >= 6 then
      raise exception 'Guests can upload up to 6 documents. Sign up free to add more.' using errcode = 'P0001';
    end if;
  elsif tg_table_name = 'tender_questions' then
    if (select count(*) from public.tender_questions q
         where q.company_id = new.company_id and q.created_at > now() - interval '1 hour') >= 10 then
      raise exception 'Guests can ask 10 questions an hour. Sign up free for more.' using errcode = 'P0001';
    end if;
  elsif tg_table_name = 'company_documents' then
    raise exception 'Sign up free to use the document vault.' using errcode = 'P0001';
  elsif tg_table_name = 'reminder_recipients' then
    raise exception 'Sign up free to get email reminders.' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger tenders_guest_limits before insert on public.tenders
for each row execute function public._guest_limits();
create trigger tender_files_guest_limits before insert on public.tender_files
for each row execute function public._guest_limits();
create trigger tender_questions_guest_limits before insert on public.tender_questions
for each row execute function public._guest_limits();
create trigger company_documents_guest_limits before insert on public.company_documents
for each row execute function public._guest_limits();
create trigger reminder_recipients_guest_limits before insert on public.reminder_recipients
for each row execute function public._guest_limits();

revoke execute on function public._guest_limits() from public, anon, authenticated;

-- ================================================================ finishing sign-up
-- A guest who has just signed up (Google or a confirmed email) names their company. This also copies
-- the new email onto their profile and puts it on the reminder list.
create function public.finish_signup(p_company text, p_person text) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_email text;
  v_company uuid := public.my_company_id();
begin
  if auth.uid() is null or public.is_guest() then
    raise exception 'Sign up first.' using errcode = '42501';
  end if;
  if v_company is null then raise exception 'No company found for this account.' using errcode = 'P0001'; end if;
  if length(trim(coalesce(p_company, ''))) < 2 then raise exception 'Enter your company name.' using errcode = '22023'; end if;
  if length(trim(coalesce(p_person, ''))) = 0 then raise exception 'Enter your name.' using errcode = '22023'; end if;

  select lower(email) into v_email from auth.users where id = auth.uid();
  if coalesce(v_email, '') = '' then raise exception 'Add an email address first.' using errcode = 'P0001'; end if;

  update public.users set email = v_email, name = trim(p_person) where id = auth.uid();
  update public.companies set name = trim(p_company) where id = v_company;
  if (select count(*) from public.reminder_recipients r where r.company_id = v_company) < 3 then
    insert into public.reminder_recipients (company_id, email, name)
    values (v_company, v_email, trim(p_person))
    on conflict do nothing;
  end if;
end $$;

revoke execute on function public.finish_signup(text, text) from public, anon;
grant execute on function public.finish_signup(text, text) to authenticated;

-- ================================================================ clearing old guest trials
-- Deletes guest logins older than p_days and their companies (tenders, files and results go with them;
-- the stored files are queued for the hourly storage cleanup by the 0006 triggers).
create function public.cleanup_guest_accounts(p_days int default 7) returns int
language plpgsql security definer set search_path = public
as $$
declare
  n int;
begin
  create temporary table _old_guests on commit drop as
    select id from auth.users where is_anonymous and created_at < now() - make_interval(days => p_days);

  delete from public.companies c
   where exists (select 1 from public.users u where u.company_id = c.id and u.id in (select id from _old_guests))
     and not exists (select 1 from public.users u where u.company_id = c.id and u.id not in (select id from _old_guests));

  delete from auth.users where id in (select id from _old_guests);
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function public.cleanup_guest_accounts(int) from public, anon, authenticated;

-- Every night at 02:23 (UTC). Re-running this file replaces the job.
select cron.unschedule('cleanup-guests') where exists (select 1 from cron.job where jobname = 'cleanup-guests');
select cron.schedule('cleanup-guests', '23 2 * * *', 'select public.cleanup_guest_accounts()');
