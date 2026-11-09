-- capture_keys table, policy "owner read", column privileges, and
-- rotate_capture_key(). A capture client's per-user bearer: only its sha256
-- is stored, and the hash never reaches a client role.
begin;
\ir _helpers.psql
select plan(41);

-- Keys handed back by rotate_capture_key, so the checks below (as postgres)
-- can compare them with what was stored. In the tests schema, which the
-- switched-to roles can write.
create table tests.issued (n serial, user_id uuid, key text);
grant insert, select on tests.issued to authenticated, service_role;
grant usage on sequence tests.issued_n_seq to authenticated;
create function tests.sha256_hex(p text) returns text language sql as $$
  select encode(sha256(convert_to(p, 'UTF8')), 'hex');
$$;

-- ─── shape ─────────────────────────────────────────────────────────────────
select has_table('public', 'capture_keys', 'capture_keys exists');
select col_is_pk('public', 'capture_keys', 'user_id', 'one key per user: user_id is the PK');
select fk_ok('public', 'capture_keys', 'user_id', 'auth', 'users', 'id', 'user_id references auth.users');
select col_not_null('public', 'capture_keys', 'key_hash', 'key_hash is not null');
select col_is_unique('public', 'capture_keys', 'key_hash', 'key_hash is unique (the lookup key)');
select col_not_null('public', 'capture_keys', 'created_at', 'created_at is not null');
select col_is_null('public', 'capture_keys', 'last_used_at', 'last_used_at is nullable (never used)');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.capture_keys'::regclass),
  'RLS is enabled on capture_keys'
);
select policies_are('public', 'capture_keys', array['owner read'], 'only the owner-read policy');

-- ─── privileges ────────────────────────────────────────────────────────────
select ok(
  not has_any_column_privilege('anon', 'public.capture_keys', 'select')
  and not has_any_column_privilege('anon', 'public.capture_keys', 'insert')
  and not has_any_column_privilege('anon', 'public.capture_keys', 'update'),
  'anon holds no privilege on capture_keys'
);
select ok(
  has_column_privilege('authenticated', 'public.capture_keys', 'created_at', 'select')
  and has_column_privilege('authenticated', 'public.capture_keys', 'last_used_at', 'select'),
  'authenticated may read created_at and last_used_at'
);
select ok(
  not has_column_privilege('authenticated', 'public.capture_keys', 'key_hash', 'select')
  and not has_column_privilege('authenticated', 'public.capture_keys', 'user_id', 'select'),
  'authenticated may not read key_hash (or user_id)'
);
select ok(
  not has_any_column_privilege('authenticated', 'public.capture_keys', 'insert')
  and not has_any_column_privilege('authenticated', 'public.capture_keys', 'update')
  and not has_table_privilege('authenticated', 'public.capture_keys', 'delete'),
  'authenticated cannot write capture_keys directly (only through the RPC)'
);

select ok(
  not has_function_privilege('anon', 'public.rotate_capture_key()', 'execute'),
  'anon cannot execute rotate_capture_key'
);
select ok(
  has_function_privilege('authenticated', 'public.rotate_capture_key()', 'execute'),
  'authenticated can execute rotate_capture_key'
);
select is(
  (select prosecdef from pg_proc where oid = 'public.rotate_capture_key()'::regprocedure),
  true, 'rotate_capture_key is security definer'
);
select is(
  (select proconfig from pg_proc where oid = 'public.rotate_capture_key()'::regprocedure),
  array['search_path=""'], 'rotate_capture_key pins an empty search_path'
);

-- ─── rotate as user A ──────────────────────────────────────────────────────
select tests.authenticate_as('00000000-0000-0000-0000-00000000000a');
select is_empty($$select created_at from capture_keys$$, 'no key before the first rotation');
insert into tests.issued (user_id, key)
  values ('00000000-0000-0000-0000-00000000000a', rotate_capture_key());
select results_eq(
  $$select created_at = now(), last_used_at is null from capture_keys$$,
  $$values (true, true)$$,
  'the owner sees their key''s created_at / last_used_at'
);
select throws_ok($$select key_hash from capture_keys$$, '42501', null, 'the owner cannot read key_hash');
select throws_ok($$select * from capture_keys$$, '42501', null, 'select * is refused (key_hash is in it)');
select throws_ok(
  $$update capture_keys set last_used_at = now()$$, '42501', null, 'the owner cannot update the row'
);
select throws_ok($$delete from capture_keys$$, '42501', null, 'the owner cannot delete the row');
select throws_ok(
  $$insert into capture_keys (user_id, key_hash) values ('00000000-0000-0000-0000-00000000000a', 'x')$$,
  '42501', null, 'the owner cannot insert a hash of their choosing'
);
reset role;

select matches(
  (select key from tests.issued where n = 1),
  '^rlk_[A-Za-z0-9_-]{43}$',
  'the key is rlk_ + 32 random bytes, base64url without padding'
);
select results_eq(
  $$select user_id, key_hash from capture_keys$$,
  $$select user_id, tests.sha256_hex(key) from tests.issued where n = 1$$,
  'only the sha256 (hex) of the returned key is stored, for its user'
);

-- B sees nothing of A's key.
select tests.authenticate_as('00000000-0000-0000-0000-00000000000b');
select is_empty($$select created_at from capture_keys$$, 'another user sees no rows');
reset role;

-- ─── rotating again replaces the key ───────────────────────────────────────
update capture_keys set created_at = now() - interval '1 day', last_used_at = now() - interval '1 hour';
select tests.authenticate_as('00000000-0000-0000-0000-00000000000a');
insert into tests.issued (user_id, key)
  values ('00000000-0000-0000-0000-00000000000a', rotate_capture_key());
select results_eq(
  $$select created_at = now(), last_used_at is null from capture_keys$$,
  $$values (true, true)$$,
  'a new key starts over: created now, never used'
);
reset role;
select isnt(
  (select key from tests.issued where n = 2), (select key from tests.issued where n = 1),
  'a rotation returns a different key'
);
select results_eq(
  $$select count(*)::int, min(key_hash) from capture_keys$$,
  $$select 1, tests.sha256_hex(key) from tests.issued where n = 2$$,
  'still one row per user, holding the new key''s hash (the old one no longer matches)'
);

-- B's key is separate.
select tests.authenticate_as('00000000-0000-0000-0000-00000000000b');
insert into tests.issued (user_id, key)
  values ('00000000-0000-0000-0000-00000000000b', rotate_capture_key());
select results_eq(
  $$select count(*)::int from capture_keys$$, $$values (1)$$, 'B sees only their own key'
);
reset role;
select results_eq(
  $$select user_id, key_hash from capture_keys order by user_id$$,
  $$select user_id, tests.sha256_hex(key) from tests.issued where n in (2, 3) order by user_id$$,
  'each user holds their own hash'
);

-- ─── rate limit ────────────────────────────────────────────────────────────
select results_eq(
  $$select (public.rate_limit_for('capture-key')).max_calls, (public.rate_limit_for('capture-key')).time_window$$,
  $$values (10, interval '1 hour')$$,
  'capture-key: 10 rotations per hour'
);
select tests.authenticate_as('00000000-0000-0000-0000-00000000000a');
-- Two rotations so far; eight more are allowed.
select lives_ok(
  $$insert into tests.issued (user_id, key)
    select '00000000-0000-0000-0000-00000000000a', rotate_capture_key() from generate_series(1, 8)$$,
  'rotations up to the limit are allowed'
);
select throws_ok(
  $$select rotate_capture_key()$$, 'PT429', 'rate limit exceeded', 'the 11th rotation in an hour is refused (HTTP 429)'
);
reset role;
select results_eq(
  $$select key_hash from capture_keys where user_id = '00000000-0000-0000-0000-00000000000a'$$,
  $$select tests.sha256_hex(key) from tests.issued order by n desc limit 1$$,
  'a refused rotation leaves the current key in place'
);

-- ─── no user ───────────────────────────────────────────────────────────────
select tests.authenticate_anon();
select throws_ok($$select rotate_capture_key()$$, '42501', null, 'anon cannot rotate a key');
reset role;
select tests.authenticate_service_role();
select throws_ok(
  $$select rotate_capture_key()$$, '42501', 'rotate_capture_key: no user',
  'a caller without auth.uid() is refused'
);
-- The capture function's service-role client: looks a key up by hash and
-- records its use.
select results_eq(
  $$select user_id from capture_keys
    where key_hash = (select tests.sha256_hex(key) from tests.issued where n = 3)$$,
  $$values ('00000000-0000-0000-0000-00000000000b'::uuid)$$,
  'service_role finds the user by key hash'
);
select lives_ok(
  $$update capture_keys set last_used_at = now() where user_id = '00000000-0000-0000-0000-00000000000b'$$,
  'service_role records last_used_at'
);
reset role;

-- Rows go away with their user.
delete from auth.users where id = '00000000-0000-0000-0000-00000000000b';
select is_empty(
  $$select 1 from capture_keys where user_id = '00000000-0000-0000-0000-00000000000b'$$,
  'deleting a user cascades to their capture key'
);

select * from finish();
rollback;
