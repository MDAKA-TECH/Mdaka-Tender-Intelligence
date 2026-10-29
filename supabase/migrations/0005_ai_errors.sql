-- Mdaka Tender Intelligence: plain-language AI errors and admin alerts.
-- Run after 0004_reminders.sql, in the Supabase SQL editor.
--
--  * tenders.ai_error_kind tells the app which message to show when AI extraction fails:
--      busy    - the AI service is busy or rate-limited; Re-run in a few minutes
--      account - out of credit/quota, billing or API-key problem; only the admin can fix it
--      input   - the tender has no readable PDFs
--      other   - anything else
--    ai_error keeps the technical detail for the admin.
--  * system_alerts: the worker records an alert when the AI account stops working (at most one per
--    24 hours). The hourly send-reminders run emails it to ADMIN_EMAIL. Only the service role can see it.

alter table public.tenders
  add column ai_error_kind text check (ai_error_kind in ('busy', 'account', 'input', 'other'));

-- Same client guard as 0003, now also protecting ai_error_kind (worker-owned).
create or replace function public._tenders_client_guard() returns trigger
language plpgsql set search_path = public
as $$
begin
  if current_user <> 'authenticated' then return new; end if;
  if tg_op = 'INSERT' then
    new.ai_status := 'none'; new.ai_error := null; new.ai_error_kind := null; new.ai_attempts := 0; new.ai_claimed_at := null;
    new.ai_model := null; new.ai_extracted_at := null; new.ai_file_ids := '{}'; new.ai_fields := null;
    return new;
  end if;
  if new.ai_status is distinct from old.ai_status then
    if not (new.ai_status = 'queued' and old.ai_status in ('none', 'done', 'failed')) then
      raise exception 'AI extraction is already queued or running.' using errcode = '42501';
    end if;
    new.ai_attempts := 0; new.ai_error := null; new.ai_error_kind := null;
  else
    new.ai_error := old.ai_error; new.ai_error_kind := old.ai_error_kind; new.ai_attempts := old.ai_attempts;
  end if;
  new.ai_claimed_at := old.ai_claimed_at; new.ai_model := old.ai_model; new.ai_extracted_at := old.ai_extracted_at;
  new.ai_file_ids := old.ai_file_ids; new.ai_fields := old.ai_fields;
  return new;
end $$;

-- A successful run clears the error kind too.
create or replace function public._clear_ai_error_kind() returns trigger
language plpgsql set search_path = public
as $$
begin
  if new.ai_status = 'done' then new.ai_error_kind := null; end if;
  return new;
end $$;
create trigger tenders_clear_ai_error_kind
before update of ai_status on public.tenders
for each row execute function public._clear_ai_error_kind();

-- ================================================================ admin alerts
create table public.system_alerts (
  id bigint generated always as identity primary key,
  kind text not null,
  message text not null,
  created_at timestamptz not null default now(),
  notified_at timestamptz
);
alter table public.system_alerts enable row level security;   -- no policies: invisible to app users
revoke all on public.system_alerts from anon, authenticated;

-- Records an alert unless one of the same kind was recorded in the last 24 hours. Returns true if recorded.
create function public.raise_system_alert(p_kind text, p_message text) returns boolean
language plpgsql security definer set search_path = public
as $$
begin
  if exists (select 1 from public.system_alerts where kind = p_kind and created_at > now() - interval '24 hours') then
    return false;
  end if;
  insert into public.system_alerts (kind, message) values (p_kind, left(p_message, 1000));
  return true;
end $$;

-- Alerts not yet emailed (send-reminders reads these, emails ADMIN_EMAIL, then marks them).
create function public.pending_system_alerts() returns jsonb
language sql security definer set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'message', message, 'created_at', created_at) order by id), '[]'::jsonb)
  from public.system_alerts where notified_at is null;
$$;

create function public.mark_system_alerts_notified(p_ids bigint[]) returns void
language sql security definer set search_path = public
as $$ update public.system_alerts set notified_at = now() where id = any(p_ids) and notified_at is null; $$;

revoke execute on function public.raise_system_alert(text, text), public.pending_system_alerts(),
  public.mark_system_alerts_notified(bigint[]), public._clear_ai_error_kind() from public, anon, authenticated;
grant execute on function public.raise_system_alert(text, text), public.pending_system_alerts(),
  public.mark_system_alerts_notified(bigint[]) to service_role;
