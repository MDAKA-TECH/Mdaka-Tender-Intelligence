-- Mdaka Tender Intelligence — week 5: run send-reminders every hour (at minute 5).
-- Run in the Supabase SQL editor AFTER deploying the function and setting its secrets.
--
-- Step 1 (once): save the same CRON_SECRET you gave the function in Supabase Vault.
-- Paste your secret between the quotes, run just this line, then delete the secret from the editor.
--   select vault.create_secret('PASTE-CRON-SECRET-HERE', 'reminders_cron_secret');
--
-- Step 2: run the rest of this file.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Re-running this file replaces the job instead of adding a second one.
select cron.unschedule('send-reminders') where exists (select 1 from cron.job where jobname = 'send-reminders');

select cron.schedule(
  'send-reminders',
  '5 * * * *',
  $$
  select net.http_post(
    url := 'https://qwpovznioeicizixdpqa.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'reminders_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);

-- Check it later:
--   select * from cron.job_run_details where jobid = (select jobid from cron.job where jobname = 'send-reminders') order by start_time desc limit 5;
--   select id, status_code, content from net._http_response order by created desc limit 5;
