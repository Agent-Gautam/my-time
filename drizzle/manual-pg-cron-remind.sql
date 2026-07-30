-- Manual SQL — NOT a Drizzle migration. Do not run via `npm run db:migrate`; drizzle-kit
-- only tracks schema changes and has no record of this file. Apply once, by hand, in the
-- Supabase SQL editor (Database → SQL Editor) against the project's own Postgres.
--
-- Why this exists at all (D37): Vercel Hobby cron allows once/day at ±59min precision,
-- and any more-frequent expression fails at deployment — unusable for "the evening
-- daypart is starting". Supabase pg_cron has neither limit, so the cron job lives here
-- and calls the Vercel endpoint over HTTP instead.
--
-- Prerequisites (Database → Extensions): enable "pg_cron" and "pg_net".
--
-- pg_cron schedules run in UTC. The four times below (05:00, 12:00, 17:00, 21:00) match
-- the default daypart seed (src/db/local/seed.ts) *in UTC* — convert to your actual
-- timezone offset, or edit after daypart boundaries change (D44), since this file does
-- not read the dayparts table.
--
-- Replace <YOUR_DEPLOYMENT_URL> and <YOUR_CRON_SECRET> (the same value as the
-- CRON_SECRET env var) before running.

select cron.schedule(
  'remind-morning',
  '0 5 * * *',
  $$
  select net.http_get(
    url := 'https://<YOUR_DEPLOYMENT_URL>/api/cron/remind',
    headers := jsonb_build_object('Authorization', 'Bearer <YOUR_CRON_SECRET>')
  );
  $$
);

select cron.schedule(
  'remind-afternoon',
  '0 12 * * *',
  $$
  select net.http_get(
    url := 'https://<YOUR_DEPLOYMENT_URL>/api/cron/remind',
    headers := jsonb_build_object('Authorization', 'Bearer <YOUR_CRON_SECRET>')
  );
  $$
);

select cron.schedule(
  'remind-evening',
  '0 17 * * *',
  $$
  select net.http_get(
    url := 'https://<YOUR_DEPLOYMENT_URL>/api/cron/remind',
    headers := jsonb_build_object('Authorization', 'Bearer <YOUR_CRON_SECRET>')
  );
  $$
);

select cron.schedule(
  'remind-night',
  '0 21 * * *',
  $$
  select net.http_get(
    url := 'https://<YOUR_DEPLOYMENT_URL>/api/cron/remind',
    headers := jsonb_build_object('Authorization', 'Bearer <YOUR_CRON_SECRET>')
  );
  $$
);

-- To remove a job later: select cron.unschedule('remind-morning'); (etc.)
-- To inspect scheduled jobs: select * from cron.job;
-- To check recent run history: select * from cron.job_run_details order by start_time desc limit 20;
