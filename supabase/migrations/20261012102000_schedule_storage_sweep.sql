-- Schedule the storage-sweep edge function daily (03:17 UTC) with pg_cron +
-- pg_net. Supersedes the commented snippet at the end of
-- 20261011171000_audit_hardening.sql.
--
-- Nothing per-environment is in this file: the job reads both the project
-- URL and the service-role key from Vault at run time, and does nothing
-- (selects no row, sends no request) until BOTH secrets exist. So a local
-- `supabase db reset` schedules a job that can never reach prod, and prod
-- stays inert until the one-time manual step:
--
--   select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
--   select vault.create_secret('<service-role key>', 'service_role_key');
--
-- (run in the SQL editor, never in a migration: the key must stay out of the repo).

-- Schemas as Supabase documents them: pg_cron lives in pg_catalog (its
-- objects in the `cron` schema), pg_net in extensions (its objects in `net`).
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- cron.schedule with a job name upserts, so re-running this is harmless.
select cron.schedule(
  'storage-sweep',
  '17 3 * * *',
  $cron$
    select net.http_post(
      url     := rtrim(s.project_url, '/') || '/functions/v1/storage-sweep',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || s.service_role_key,
        'Content-Type', 'application/json'),
      body    := '{}'::jsonb)
    from (select
            (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
              as project_url,
            (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
              as service_role_key) s
    where s.project_url is not null and s.service_role_key is not null
  $cron$
);
