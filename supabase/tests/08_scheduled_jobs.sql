-- Scheduled jobs: the pg_cron 'storage-sweep' job (schedule_storage_sweep
-- migration). Its command is run here directly: without both Vault secrets
-- it must queue no request; with them it queues exactly one POST to the
-- project's storage-sweep function. pg_net only sends committed queue rows
-- and this transaction rolls back, so nothing ever leaves the machine.
begin;
\ir _helpers.psql
select plan(11);

select has_extension('pg_cron');
select has_extension('pg_net');

select is(
  (select array_agg(jobname order by jobname) from cron.job),
  array['storage-sweep']::text[],
  'storage-sweep is the only scheduled job'
);
select results_eq(
  $$select schedule, active, username::text, database::text from cron.job where jobname = 'storage-sweep'$$,
  $$values ('17 3 * * *'::text, true, 'postgres'::text, 'postgres'::text)$$,
  'storage-sweep runs daily at 03:17 as postgres'
);
select unalike(
  (select command from cron.job where jobname = 'storage-sweep'),
  '%supabase.co%',
  'the job hard-codes no project URL'
);

-- Start from no secrets, whatever this stack holds (rolled back).
delete from vault.secrets where name in ('project_url', 'service_role_key');
create temp table queued_before as select count(*) as n from net.http_request_queue;

select lives_ok(
  (select command from cron.job where jobname = 'storage-sweep'),
  'the job runs without secrets'
);
select is(
  (select count(*) from net.http_request_queue), (select n from queued_before),
  'without secrets the job queues no request'
);

select vault.create_secret('http://functions.test/', 'project_url');
select lives_ok(
  (select command from cron.job where jobname = 'storage-sweep'),
  'the job runs with only project_url'
);
select is(
  (select count(*) from net.http_request_queue), (select n from queued_before),
  'without service_role_key the job still queues no request'
);

select vault.create_secret('test-service-role-key', 'service_role_key');
select lives_ok(
  (select command from cron.job where jobname = 'storage-sweep'),
  'the job runs with both secrets'
);
select results_eq(
  $$select method::text, url, headers->>'Authorization', headers->>'Content-Type'
    from net.http_request_queue order by id desc limit 1$$,
  $$values ('POST', 'http://functions.test/functions/v1/storage-sweep',
            'Bearer test-service-role-key', 'application/json')$$,
  'with both secrets the job POSTs to storage-sweep with the service-role bearer'
);

select * from finish();
rollback;
