-- rate_limits table, rate_limit_for(), bump_rate_limit_for_user(), bump_rate_limit().
-- The limits live in Postgres (rate_limit_for): callers name an action and
-- never supply the limit or the window themselves.
begin;
\ir _helpers.psql
select plan(32);

select has_table('public', 'rate_limits', 'rate_limits exists');
select col_is_pk('public', 'rate_limits', array['user_id', 'action'], 'rate_limits PK (user_id, action)');
select policies_are('public', 'rate_limits', array[]::name[], 'rate_limits has no policies');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.rate_limits'::regclass),
  'RLS is enabled on rate_limits'
);
select ok(
  not has_table_privilege('authenticated', 'public.rate_limits', 'select')
  and not has_table_privilege('anon', 'public.rate_limits', 'select')
  and not has_table_privilege('authenticated', 'public.rate_limits', 'insert'),
  'anon/authenticated have no table privileges on rate_limits'
);

-- ─── signatures: no caller-supplied limits ─────────────────────────────────
select hasnt_function('public', 'bump_rate_limit', array['text', 'integer', 'interval'],
  'the old bump_rate_limit(action, max, window) is gone');
select hasnt_function('public', 'bump_rate_limit_for_user', array['uuid', 'text', 'integer', 'interval'],
  'the old bump_rate_limit_for_user(user, action, max, window) is gone');
select ok(
  not has_function_privilege('anon', 'public.bump_rate_limit(text)', 'execute'),
  'anon cannot execute bump_rate_limit'
);
select ok(
  has_function_privilege('authenticated', 'public.bump_rate_limit(text)', 'execute'),
  'authenticated can execute bump_rate_limit'
);
select ok(
  not has_function_privilege('authenticated', 'public.bump_rate_limit_for_user(uuid, text)', 'execute')
  and not has_function_privilege('anon', 'public.bump_rate_limit_for_user(uuid, text)', 'execute'),
  'anon/authenticated cannot execute bump_rate_limit_for_user'
);
select ok(
  has_function_privilege('service_role', 'public.bump_rate_limit_for_user(uuid, text)', 'execute'),
  'service_role can execute bump_rate_limit_for_user'
);
select ok(
  not has_function_privilege('authenticated', 'public.rate_limit_for(text)', 'execute')
  and not has_function_privilege('anon', 'public.rate_limit_for(text)', 'execute'),
  'anon/authenticated cannot execute rate_limit_for'
);

select results_eq(
  $$select a, (public.rate_limit_for(a)).max_calls, (public.rate_limit_for(a)).time_window
    from unnest(array['capture', 'translate', 'snippet', 'file-import', 'pdf-import']) a$$,
  $$values ('capture', 120, interval '1 hour'), ('translate', 20, interval '1 hour'),
           ('snippet', 30, interval '1 hour'), ('file-import', 30, interval '1 hour'),
           ('pdf-import', 30, interval '1 hour')$$,
  'per-action limits'
);

-- ─── bump_rate_limit as user A ─────────────────────────────────────────────
select tests.authenticate_as('00000000-0000-0000-0000-00000000000a');

select is(
  (select bool_and(bump_rate_limit('translate')) from generate_series(1, 20)),
  true, 'translate: 20 calls allowed'
);
select is(bump_rate_limit('translate'), false, 'call 21 over the limit refused');
select is(bump_rate_limit('translate'), false, 'retrying while limited stays refused');
select is(bump_rate_limit('capture'), true, 'a different action has its own window');
select throws_ok(
  $$select bump_rate_limit('made-up-action')$$,
  '22023', null, 'an unknown action is rejected (no free-text rows)'
);
select throws_ok(
  $$select * from rate_limits$$, '42501', null, 'the user cannot read rate_limits directly'
);
select throws_ok(
  $$select bump_rate_limit_for_user('00000000-0000-0000-0000-00000000000b', 'translate')$$,
  '42501', null, 'authenticated cannot bump another user''s counter'
);

-- ─── user B is isolated ────────────────────────────────────────────────────
select tests.authenticate_as('00000000-0000-0000-0000-00000000000b');
select is(bump_rate_limit('translate'), true, 'B has its own counter for the same action');
reset role;

select results_eq(
  $$select user_id, action, count, window_start = now() from rate_limits order by user_id, action$$,
  $$values ('00000000-0000-0000-0000-00000000000a'::uuid, 'capture'::text, 1, true),
           ('00000000-0000-0000-0000-00000000000a'::uuid, 'translate'::text, 21, true),
           ('00000000-0000-0000-0000-00000000000b'::uuid, 'translate'::text, 1, true)$$,
  'refused calls are capped at max + 1; counters are per (user, action)'
);

-- ─── window expiry ─────────────────────────────────────────────────────────
update rate_limits set window_start = now() - interval '59 minutes'
where user_id = '00000000-0000-0000-0000-00000000000a' and action = 'translate';
select tests.authenticate_as('00000000-0000-0000-0000-00000000000a');
select is(bump_rate_limit('translate'), false, 'still refused inside the window');
reset role;

update rate_limits set window_start = now() - interval '1 hour'
where user_id = '00000000-0000-0000-0000-00000000000a' and action = 'translate';
select tests.authenticate_as('00000000-0000-0000-0000-00000000000a');
select is(bump_rate_limit('translate'), true, 'allowed again once the window has elapsed');
reset role;
select results_eq(
  $$select count, window_start = now() from rate_limits
    where user_id = '00000000-0000-0000-0000-00000000000a' and action = 'translate'$$,
  $$values (1, true)$$,
  'an elapsed window restarts at count 1 from now()'
);

-- ─── no user ───────────────────────────────────────────────────────────────
select tests.authenticate_anon();
select throws_ok(
  $$select bump_rate_limit('translate')$$,
  '42501', null, 'anon cannot call bump_rate_limit'
);
reset role;

select tests.authenticate_service_role();
select throws_ok(
  $$select bump_rate_limit_for_user(null, 'capture')$$,
  '42501', 'bump_rate_limit: no user', 'bump_rate_limit_for_user refuses a null user'
);
update rate_limits set count = 120
where user_id = '00000000-0000-0000-0000-00000000000a' and action = 'capture';
select is(
  bump_rate_limit_for_user('00000000-0000-0000-0000-00000000000a', 'capture'),
  false, 'service_role call over the capture limit refused'
);
select is(
  bump_rate_limit_for_user('00000000-0000-0000-0000-00000000000b', 'capture'),
  true, 'service_role bumps a given user''s counter'
);
reset role;

select is(
  (select prosecdef from pg_proc where oid = 'public.bump_rate_limit(text)'::regprocedure),
  true, 'bump_rate_limit is security definer'
);
select is(
  (select proconfig from pg_proc where oid = 'public.bump_rate_limit_for_user(uuid, text)'::regprocedure),
  array['search_path=""'], 'bump_rate_limit_for_user pins an empty search_path'
);

-- Rows go away with their user.
delete from auth.users where id = '00000000-0000-0000-0000-00000000000b';
select is_empty(
  $$select 1 from rate_limits where user_id = '00000000-0000-0000-0000-00000000000b'$$,
  'deleting a user cascades to their rate_limits rows'
);

select * from finish();
rollback;
