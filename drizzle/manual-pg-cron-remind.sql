-- Manual SQL — NOT a Drizzle migration. Do not run via `npm run db:migrate`; drizzle-kit
-- only tracks schema changes and has no record of this file.
--
-- Why this exists at all (D37): Vercel Hobby cron allows once/day at ±59min precision,
-- and any more-frequent expression fails at deployment — unusable for "the evening
-- daypart is starting". Supabase pg_cron has neither limit, so the cron job lives here
-- and calls the Vercel endpoint over HTTP instead.
--
-- Prerequisites — already applied to this project:
--   create extension if not exists pg_cron;
--   create extension if not exists pg_net with schema extensions;
--
-- ---------------------------------------------------------------------------
-- TIMEZONE — the thing this file previously got wrong
-- ---------------------------------------------------------------------------
-- pg_cron schedules are evaluated in the database's timezone, which on Supabase is
-- **UTC**. The daypart boundaries are wall-clock *local* times (D53), so the cron
-- expressions are the local boundary MINUS the UTC offset. Writing `0 5 * * *` for a
-- 05:00 daypart fires at 10:30 local in IST — five and a half hours late, every day,
-- silently.
--
-- Current values are for **IST (UTC+5:30)**:
--
--   daypart     local    UTC        cron
--   morning     05:00    23:30 (-1) 30 23 * * *
--   afternoon   12:00    06:30      30 6  * * *
--   evening     17:00    11:30      30 11 * * *
--   night       21:00    15:30      30 15 * * *
--
-- **These do not follow the dayparts table.** Editing boundaries in settings (D44)
-- does not reschedule anything here — come back and edit this by hand. A server-side
-- job cannot read the user's dayparts without the server knowing the plan, which is
-- exactly the coupling D33/D34 removed.
--
-- ---------------------------------------------------------------------------
-- The secret is stored in plaintext in `cron.job.command`. Anyone with database
-- access can read it. That is inherent to calling an authenticated HTTP endpoint from
-- pg_cron; rotating CRON_SECRET means rotating it here too.
-- ---------------------------------------------------------------------------
--
-- Replace <YOUR_CRON_SECRET> with the CRON_SECRET env var's value before running.

select cron.schedule(
  'remind-morning',
  '30 23 * * *', -- 05:00 IST
  $$
  select net.http_get(
    url := 'https://my-time-nu-brown.vercel.app/api/cron/remind',
    headers := jsonb_build_object('Authorization', 'Bearer <YOUR_CRON_SECRET>')
  );
  $$
);

select cron.schedule(
  'remind-afternoon',
  '30 6 * * *', -- 12:00 IST
  $$
  select net.http_get(
    url := 'https://my-time-nu-brown.vercel.app/api/cron/remind',
    headers := jsonb_build_object('Authorization', 'Bearer <YOUR_CRON_SECRET>')
  );
  $$
);

select cron.schedule(
  'remind-evening',
  '30 11 * * *', -- 17:00 IST
  $$
  select net.http_get(
    url := 'https://my-time-nu-brown.vercel.app/api/cron/remind',
    headers := jsonb_build_object('Authorization', 'Bearer <YOUR_CRON_SECRET>')
  );
  $$
);

select cron.schedule(
  'remind-night',
  '30 15 * * *', -- 21:00 IST
  $$
  select net.http_get(
    url := 'https://my-time-nu-brown.vercel.app/api/cron/remind',
    headers := jsonb_build_object('Authorization', 'Bearer <YOUR_CRON_SECRET>')
  );
  $$
);

-- Remove a job:      select cron.unschedule('remind-morning');
-- Inspect jobs:      select jobname, schedule, active from cron.job order by jobname;
-- Recent runs:       select jobname, status, return_message, start_time
--                      from cron.job_run_details order by start_time desc limit 20;
-- Check the HTTP call actually landed (pg_net is async — cron.job_run_details only
-- reports that the request was *queued*, not its response):
--                    select id, status_code, error_msg, created
--                      from net._http_response order by created desc limit 10;
