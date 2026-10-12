-- bookmarks triggers: bookmarks_touch_updated_at, bookmarks_record_deletion
-- (+ bookmark_deletions table/RLS), bookmarks_reset_retry.
--
-- now() is fixed for the whole test transaction, so "was bumped" is checked
-- as "moved from an old fixture value to now()".
begin;
\ir _helpers.psql
select plan(32);

select has_trigger('public'::name, 'bookmarks'::name, 'bookmarks_touch_updated_at'::name);
select has_trigger('public'::name, 'bookmarks'::name, 'bookmarks_record_deletion'::name);
select has_trigger('public'::name, 'bookmarks'::name, 'bookmarks_reset_retry'::name);
select trigger_is('public', 'bookmarks', 'bookmarks_touch_updated_at', 'public', 'bookmarks_touch_updated_at');
select trigger_is('public', 'bookmarks', 'bookmarks_record_deletion', 'public', 'bookmarks_record_deletion');
select trigger_is('public', 'bookmarks', 'bookmarks_reset_retry', 'public', 'bookmarks_reset_retry');

insert into bookmarks (id, user_id, url, type, status, updated_at, attempts, next_attempt_at)
values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a',
   'https://a.example/1', 'article', 'ready', '2000-01-01', 0, null),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-00000000000a',
   'https://a.example/2', 'article', 'failed', '2000-01-01', 3, '2100-01-01'),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-00000000000a',
   'https://a.example/3', 'article', 'pending', '2000-01-01', 2, '2100-01-01'),
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-00000000000a',
   'https://a.example/4', 'article', 'processing', '2000-01-01', 1, null),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000000b',
   'https://b.example/1', 'article', 'ready', '2000-01-01', 0, null);

-- ─── updated_at ────────────────────────────────────────────────────────────
select is(
  (select updated_at from bookmarks where id = '00000000-0000-0000-0000-0000000000a1'),
  '2000-01-01'::timestamptz, 'insert keeps an explicit updated_at (trigger is update-only)'
);

select tests.authenticate_as('00000000-0000-0000-0000-00000000000a');
update bookmarks set progress = 0.4 where id = '00000000-0000-0000-0000-0000000000a1';
select is(
  (select updated_at from bookmarks where id = '00000000-0000-0000-0000-0000000000a1'),
  now(), 'any update bumps updated_at to now()'
);
update bookmarks set updated_at = '1999-01-01' where id = '00000000-0000-0000-0000-0000000000a1';
select is(
  (select updated_at from bookmarks where id = '00000000-0000-0000-0000-0000000000a1'),
  now(), 'a client cannot set updated_at backwards (trigger overrides it)'
);

-- ─── bookmarks_reset_retry ─────────────────────────────────────────────────
-- User "Try again" on a failed row: only status changes → budget restarts.
update bookmarks set status = 'pending', error_message = null
where id = '00000000-0000-0000-0000-0000000000a2';
select results_eq(
  $$select status, attempts, next_attempt_at from bookmarks where id = '00000000-0000-0000-0000-0000000000a2'$$,
  $$values ('pending'::text, 0, null::timestamptz)$$,
  'user re-queue to pending resets attempts and next_attempt_at'
);

-- Refresh of a row still waiting out a backoff: becomes due immediately.
update bookmarks set status = 'pending' where id = '00000000-0000-0000-0000-0000000000a3';
select results_eq(
  $$select attempts, next_attempt_at from bookmarks where id = '00000000-0000-0000-0000-0000000000a3'$$,
  $$values (0, null::timestamptz)$$,
  'pending → pending refresh by a user resets the backoff'
);

reset role;
select tests.authenticate_service_role();

-- Worker transient retry: sets attempts explicitly → kept.
update bookmarks set status = 'pending', attempts = 2, next_attempt_at = '2100-02-02'
where id = '00000000-0000-0000-0000-0000000000a4';
select results_eq(
  $$select status, attempts, next_attempt_at from bookmarks where id = '00000000-0000-0000-0000-0000000000a4'$$,
  $$values ('pending'::text, 2, '2100-02-02'::timestamptz)$$,
  'worker re-queue that sets attempts keeps attempts/next_attempt_at'
);

-- Worker shutdown hand-back: changes next_attempt_at only → kept.
update bookmarks set status = 'processing' where id = '00000000-0000-0000-0000-0000000000a4';
update bookmarks set status = 'pending', next_attempt_at = '2100-03-03'
where id = '00000000-0000-0000-0000-0000000000a4';
select results_eq(
  $$select attempts, next_attempt_at from bookmarks where id = '00000000-0000-0000-0000-0000000000a4'$$,
  $$values (2, '2100-03-03'::timestamptz)$$,
  'worker re-queue that sets next_attempt_at keeps the retry state'
);

-- Moving to a non-pending status leaves the counters alone.
update bookmarks set status = 'failed' where id = '00000000-0000-0000-0000-0000000000a4';
select results_eq(
  $$select attempts, next_attempt_at from bookmarks where id = '00000000-0000-0000-0000-0000000000a4'$$,
  $$values (2, '2100-03-03'::timestamptz)$$,
  'update to a non-pending status does not reset the retry state'
);

-- An update not touching status doesn't fire the trigger at all.
update bookmarks set attempts = 5 where id = '00000000-0000-0000-0000-0000000000a4';
update bookmarks set title = 't' where id = '00000000-0000-0000-0000-0000000000a4';
select is(
  (select attempts from bookmarks where id = '00000000-0000-0000-0000-0000000000a4'),
  5, 'updates that do not set status leave attempts unchanged'
);
reset role;

-- ─── deletion tombstones ───────────────────────────────────────────────────
select policies_are('public', 'bookmark_deletions', array['owner read']);
select policy_cmd_is('public'::name, 'bookmark_deletions'::name, 'owner read'::name, 'select'::text);
select policy_roles_are('public', 'bookmark_deletions', 'owner read', array['authenticated']);

select tests.authenticate_as('00000000-0000-0000-0000-00000000000a');
delete from bookmarks where id = '00000000-0000-0000-0000-0000000000a1';
select results_eq(
  $$select bookmark_id, user_id, deleted_at from bookmark_deletions$$,
  $$values ('00000000-0000-0000-0000-0000000000a1'::uuid, '00000000-0000-0000-0000-00000000000a'::uuid, now())$$,
  'deleting a bookmark records a tombstone the owner can read'
);
select throws_ok(
  $$insert into bookmark_deletions (bookmark_id, user_id) values (gen_random_uuid(), auth.uid())$$,
  '42501', null, 'clients cannot write tombstones'
);
select is_empty(
  $$update bookmark_deletions set deleted_at = '2000-01-01' returning 1$$,
  'clients cannot update tombstones'
);
select is_empty(
  $$delete from bookmark_deletions returning 1$$,
  'clients cannot delete tombstones'
);

select tests.authenticate_as('00000000-0000-0000-0000-00000000000b');
select is_empty('select 1 from bookmark_deletions', 'B cannot read A''s tombstones');
delete from bookmarks where id = '00000000-0000-0000-0000-0000000000b1';
select results_eq(
  'select bookmark_id from bookmark_deletions',
  $$values ('00000000-0000-0000-0000-0000000000b1'::uuid)$$,
  'B reads only own tombstone'
);

select tests.authenticate_anon();
select is_empty('select 1 from bookmark_deletions', 'anon reads no tombstones');
reset role;

-- Re-deleting an id (re-imported, deleted again) upserts the tombstone.
update bookmark_deletions set deleted_at = '2000-01-01'
where bookmark_id = '00000000-0000-0000-0000-0000000000a1';
insert into bookmarks (id, user_id, url, type)
values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a',
        'https://a.example/1', 'article');
select lives_ok(
  $$delete from bookmarks where id = '00000000-0000-0000-0000-0000000000a1'$$,
  'deleting an id that already has a tombstone succeeds'
);
select results_eq(
  $$select count(*)::int, max(deleted_at) from bookmark_deletions
    where bookmark_id = '00000000-0000-0000-0000-0000000000a1'$$,
  $$values (1, now())$$,
  'the existing tombstone is refreshed, not duplicated'
);

-- A user delete cascades to their tombstones.
delete from bookmarks where user_id = '00000000-0000-0000-0000-00000000000b';
delete from auth.users where id = '00000000-0000-0000-0000-00000000000b';
select is_empty(
  $$select 1 from bookmark_deletions where user_id = '00000000-0000-0000-0000-00000000000b'$$,
  'deleting a user cascades to their tombstones'
);

select is(
  (select prosecdef from pg_proc where oid = 'public.bookmarks_record_deletion()'::regprocedure),
  true, 'bookmarks_record_deletion is security definer'
);
select ok(
  (select proconfig @> array['search_path=public'] from pg_proc
   where oid = 'public.bookmarks_record_deletion()'::regprocedure),
  'bookmarks_record_deletion pins search_path'
);
select is(
  (select prosecdef from pg_proc where oid = 'public.bookmarks_touch_updated_at()'::regprocedure),
  false, 'bookmarks_touch_updated_at is security invoker'
);
select is(
  (select prosecdef from pg_proc where oid = 'public.bookmarks_reset_retry()'::regprocedure),
  false, 'bookmarks_reset_retry is security invoker'
);

select * from finish();
rollback;
