-- security_events (security_events migration): owner-only reads, no client
-- writes, and the triggers that record sign-ins, capture key generation,
-- sharing changes and deletes.
begin;
\ir _helpers.psql
select plan(17);

-- ─── shape and privileges ──────────────────────────────────────────────────
select has_table('public', 'security_events', 'security_events exists');
select fk_ok('public', 'security_events', 'user_id', 'auth', 'users', 'id',
             'user_id references auth.users');
select policies_are('public', 'security_events', array['owner read'], 'only the owner-read policy');
select ok(
  not has_table_privilege('anon', 'public.security_events', 'select'),
  'anon cannot read security_events'
);
select ok(
  not has_table_privilege('authenticated', 'public.security_events', 'insert')
  and not has_table_privilege('authenticated', 'public.security_events', 'update')
  and not has_table_privilege('authenticated', 'public.security_events', 'delete'),
  'authenticated cannot write security_events (only the triggers do)'
);

-- ─── sign-in ───────────────────────────────────────────────────────────────
insert into auth.sessions (id, user_id, user_agent, ip)
values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a',
        'Mozilla/5.0 (X11; Linux x86_64) Firefox/140.0', '203.0.113.7');
select results_eq(
  $$select kind, detail from security_events where user_id = '00000000-0000-0000-0000-00000000000a'$$,
  $$values ('sign_in'::text,
            '{"ip": "203.0.113.7", "user_agent": "Mozilla/5.0 (X11; Linux x86_64) Firefox/140.0"}'::jsonb)$$,
  'a new session records a sign-in with its user agent and IP'
);
insert into auth.sessions (id, user_id) values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000b');
select is(
  (select detail from security_events where user_id = '00000000-0000-0000-0000-00000000000b'),
  '{}'::jsonb,
  'a session without user agent or IP records an empty detail'
);
delete from security_events;

-- ─── capture key ───────────────────────────────────────────────────────────
select tests.authenticate_as('00000000-0000-0000-0000-00000000000a');
select lives_ok($$select public.rotate_capture_key()$$, 'first key');
select lives_ok($$select public.rotate_capture_key()$$, 'replacement key');
reset role;
select results_eq(
  $$select kind from security_events where user_id = '00000000-0000-0000-0000-00000000000a'$$,
  $$values ('capture_key_rotated'::text), ('capture_key_rotated'::text)$$,
  'generating a key and replacing it are both recorded'
);
update capture_keys set last_used_at = now();
select is(
  (select count(*)::int from security_events), 2,
  'using the key (last_used_at) records nothing'
);
delete from security_events;

-- ─── sharing and deletes, as the owner through RLS ─────────────────────────
insert into bookmarks (id, user_id, url, title, type, status, is_public)
values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a',
        'https://a.example/1', 'First', 'article', 'ready', false),
       ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-00000000000a',
        'https://a.example/2', null, 'article', 'ready', true);
select is(
  (select array_agg(kind || ':' || (detail->>'title')) from security_events),
  array['link_shared:https://a.example/2'],
  'inserting a public bookmark records a share, named by its URL when untitled'
);
delete from security_events;

select tests.authenticate_as('00000000-0000-0000-0000-00000000000a');
update bookmarks set is_public = true where id = '00000000-0000-0000-0000-0000000000a1';
update bookmarks set title = 'Renamed' where id = '00000000-0000-0000-0000-0000000000a1';
update bookmarks set is_public = false where id = '00000000-0000-0000-0000-0000000000a1';
delete from bookmarks where id = '00000000-0000-0000-0000-0000000000a1';
select results_eq(
  $$select kind, detail->>'title', detail->>'bookmark_id' from security_events order by id$$,
  $$values ('link_shared'::text, 'First'::text, '00000000-0000-0000-0000-0000000000a1'::text),
           ('link_unshared', 'Renamed', '00000000-0000-0000-0000-0000000000a1'),
           ('bookmark_deleted', 'Renamed', '00000000-0000-0000-0000-0000000000a1')$$,
  'the owner sees their share, unshare and delete; other edits record nothing'
);

-- ─── isolation ─────────────────────────────────────────────────────────────
select tests.authenticate_as('00000000-0000-0000-0000-00000000000b');
select is(
  (select count(*)::int from security_events), 0,
  'another user sees none of them'
);
select throws_ok(
  $$insert into security_events (user_id, kind) values ('00000000-0000-0000-0000-00000000000b', 'sign_in')$$,
  '42501', null, 'a client cannot forge an event'
);
reset role;

-- ─── user removal and retention ────────────────────────────────────────────
delete from auth.users where id = '00000000-0000-0000-0000-00000000000a';
select is(
  (select count(*)::int from security_events), 0,
  'removing a user removes their events (and records no deletes for them)'
);

insert into security_events (user_id, kind, created_at)
values ('00000000-0000-0000-0000-00000000000b', 'sign_in', now() - interval '91 days'),
       ('00000000-0000-0000-0000-00000000000b', 'sign_in', now() - interval '89 days');
do $$ begin execute (select command from cron.job where jobname = 'security-events-prune'); end $$;
select is(
  (select count(*)::int from security_events), 1,
  'the nightly prune drops events older than 90 days'
);

select * from finish();
rollback;
