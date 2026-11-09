-- Security activity log: what happened to an account, readable by its owner
-- in Settings. Rows are written only by the triggers below (never by a
-- client), and kept for 90 days.
--
--   sign_in             a new Auth session (any sign-in method); detail has
--                       the browser's user agent and IP as Auth recorded them.
--                       Token refreshes keep their session, so they don't count.
--   capture_key_rotated a capture key was generated (the first one or a new one)
--   link_shared         a bookmark was made public
--   link_unshared       a public bookmark was made private again
--   bookmark_deleted    a bookmark was deleted
--
-- Bookmark events carry the bookmark's id and title (its URL when untitled),
-- so a deleted one can still be named.
--
-- Supabase's own auth.audit_log_entries isn't written on this project (it
-- holds no rows), hence the trigger on auth.sessions.

create table public.security_events (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  kind       text not null check (kind in ('sign_in', 'capture_key_rotated', 'link_shared',
                                           'link_unshared', 'bookmark_deleted')),
  detail     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- The Settings list: one user's newest first.
create index security_events_user_created_idx on public.security_events (user_id, created_at desc);

alter table public.security_events enable row level security;

create policy "owner read" on public.security_events
  for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.security_events from anon, authenticated;
grant select on public.security_events to authenticated;

-- ─── writers ─────────────────────────────────────────────────────────────────

-- Sign-in. Runs inside Auth's own insert, so a failure here must never block
-- signing in: it is logged as a warning and the session goes ahead.
create function public.security_events_sign_in()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    insert into public.security_events (user_id, kind, detail)
    values (new.user_id, 'sign_in',
            jsonb_strip_nulls(jsonb_build_object('user_agent', new.user_agent,
                                                 'ip', host(new.ip))));
  exception when others then
    raise warning 'security_events_sign_in: % (%)', sqlerrm, sqlstate;
  end;
  return null;
end;
$$;

create trigger security_events_sign_in
  after insert on auth.sessions
  for each row execute function public.security_events_sign_in();

-- Capture key generated: rotate_capture_key() inserts or replaces the hash.
create function public.security_events_capture_key()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.security_events (user_id, kind) values (new.user_id, 'capture_key_rotated');
  return null;
end;
$$;

create trigger security_events_capture_key
  after insert or update of key_hash on public.capture_keys
  for each row execute function public.security_events_capture_key();

-- Sharing changes and deletes. A delete cascading from removing the whole
-- user is skipped: nobody is left to read it (and the user row it would
-- reference is going away).
create function public.security_events_bookmark()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.bookmarks := case when tg_op = 'DELETE' then old else new end;
  event text;
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from auth.users where id = b.user_id) then
      return null;
    end if;
    event := 'bookmark_deleted';
  elsif tg_op = 'INSERT' then
    event := 'link_shared';
  else
    event := case when b.is_public then 'link_shared' else 'link_unshared' end;
  end if;
  insert into public.security_events (user_id, kind, detail)
  values (b.user_id, event,
          jsonb_build_object('bookmark_id', b.id, 'title', coalesce(b.title, b.url)));
  return null;
end;
$$;

create trigger security_events_bookmark_shared
  after insert on public.bookmarks
  for each row
  when (new.is_public)
  execute function public.security_events_bookmark();

create trigger security_events_bookmark_sharing
  after update of is_public on public.bookmarks
  for each row
  when (old.is_public is distinct from new.is_public)
  execute function public.security_events_bookmark();

create trigger security_events_bookmark_deleted
  after delete on public.bookmarks
  for each row execute function public.security_events_bookmark();

revoke execute on function public.security_events_sign_in() from public, anon, authenticated;
revoke execute on function public.security_events_capture_key() from public, anon, authenticated;
revoke execute on function public.security_events_bookmark() from public, anon, authenticated;

-- ─── retention ───────────────────────────────────────────────────────────────

-- Daily, after the storage sweep. cron.schedule with a job name upserts.
select cron.schedule(
  'security-events-prune',
  '47 3 * * *',
  $cron$delete from public.security_events where created_at < now() - interval '90 days'$cron$
);
