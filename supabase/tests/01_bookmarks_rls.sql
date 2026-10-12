-- bookmarks: RLS policy "owner access", get_public_bookmark().
begin;
\ir _helpers.psql
select plan(27);

-- Fixtures (as postgres, bypassing RLS).
insert into bookmarks (id, user_id, url, type, status, title, content_md, is_public, pdf_path,
                       error_message, progress, translated_content_md)
values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a',
   'https://a.example/one', 'article', 'ready', 'A one', 'body a1', false, null, null, 0, null),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-00000000000a',
   null, 'pdf', 'ready', 'A public pdf', 'body a2', true,
   '00000000-0000-0000-0000-00000000000a/x.pdf', 'secret err', 0.5, 'secret translation'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000000b',
   'https://b.example/one', 'article', 'ready', 'B one', 'body b1', false, null, null, 0, null);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.bookmarks'::regclass),
  'RLS is enabled on bookmarks'
);
select policies_are('public', 'bookmarks', array['owner access']);
select policy_roles_are('public', 'bookmarks', 'owner access', array['authenticated']);
select policy_cmd_is('public'::name, 'bookmarks'::name, 'owner access'::name, 'all'::text);

-- ─── user A ────────────────────────────────────────────────────────────────
select tests.authenticate_as('00000000-0000-0000-0000-00000000000a');

select results_eq(
  'select id from bookmarks order by id',
  $$values ('00000000-0000-0000-0000-0000000000a1'::uuid), ('00000000-0000-0000-0000-0000000000a2'::uuid)$$,
  'A sees only own bookmarks'
);
select is_empty(
  $$select 1 from bookmarks where user_id = '00000000-0000-0000-0000-00000000000b'$$,
  'A cannot select B''s bookmark even by user_id filter'
);

select lives_ok(
  $$insert into bookmarks (user_id, url, type) values ('00000000-0000-0000-0000-00000000000a', 'https://a.example/new', 'article')$$,
  'A can insert an own bookmark'
);
select throws_ok(
  $$insert into bookmarks (user_id, url, type) values ('00000000-0000-0000-0000-00000000000b', 'https://a.example/forged', 'article')$$,
  '42501', null,
  'A cannot insert a bookmark owned by B (with check)'
);

-- update/delete of B's row: filtered by USING, so zero rows affected.
select is_empty(
  $$update bookmarks set title = 'hacked' where id = '00000000-0000-0000-0000-0000000000b1' returning id$$,
  'A''s update of B''s bookmark affects no rows'
);
select is_empty(
  $$delete from bookmarks where id = '00000000-0000-0000-0000-0000000000b1' returning id$$,
  'A''s delete of B''s bookmark affects no rows'
);
select throws_ok(
  $$update bookmarks set user_id = '00000000-0000-0000-0000-00000000000b' where id = '00000000-0000-0000-0000-0000000000a1'$$,
  '42501', null,
  'A cannot hand an own bookmark over to B (with check on update)'
);
select lives_ok(
  $$update bookmarks set title = 'renamed' where id = '00000000-0000-0000-0000-0000000000a1'$$,
  'A can update own bookmark'
);

-- get_public_bookmark: public rows only, regardless of caller.
select is(
  (select count(*)::int from get_public_bookmark('00000000-0000-0000-0000-0000000000a1')),
  0, 'get_public_bookmark returns nothing for a private bookmark (even to its owner)'
);

-- ─── user B ────────────────────────────────────────────────────────────────
select tests.authenticate_as('00000000-0000-0000-0000-00000000000b');
select results_eq(
  'select id from bookmarks',
  $$values ('00000000-0000-0000-0000-0000000000b1'::uuid)$$,
  'B sees only own bookmark'
);
select is(
  (select title from get_public_bookmark('00000000-0000-0000-0000-0000000000a2')),
  'A public pdf', 'get_public_bookmark returns another user''s public bookmark'
);

-- ─── anon ──────────────────────────────────────────────────────────────────
select tests.authenticate_anon();
select is_empty('select 1 from bookmarks', 'anon sees no bookmarks');
select throws_ok(
  $$insert into bookmarks (user_id, url, type) values ('00000000-0000-0000-0000-00000000000a', 'https://anon.example', 'article')$$,
  '42501', null, 'anon cannot insert bookmarks'
);
select is_empty(
  $$update bookmarks set title = 'x' returning id$$, 'anon update affects no rows'
);
select is_empty(
  $$delete from bookmarks returning id$$, 'anon delete affects no rows'
);

select results_eq(
  $$select id, type, title, content_md from get_public_bookmark('00000000-0000-0000-0000-0000000000a2')$$,
  $$values ('00000000-0000-0000-0000-0000000000a2'::uuid, 'pdf'::text, 'A public pdf'::text, 'body a2'::text)$$,
  'anon gets a public bookmark by exact id'
);
select is_empty(
  $$select * from get_public_bookmark('00000000-0000-0000-0000-0000000000b1')$$,
  'anon gets nothing for a private bookmark'
);
select is_empty(
  $$select * from get_public_bookmark(null)$$,
  'get_public_bookmark(null) returns nothing (no enumeration)'
);

reset role;

-- Only public-safe columns: exactly this list, nothing owner-private.
select is(
  (select array_agg(a order by ord) from unnest(
     (select proargnames from pg_proc where oid = 'public.get_public_bookmark(uuid)'::regprocedure)
   ) with ordinality as t(a, ord) where ord > 1),
  array['id', 'type', 'title', 'author', 'excerpt', 'content_md', 'thumbnail_url',
        'youtube_video_id', 'word_count', 'reading_time', 'created_at']::text[],
  'get_public_bookmark returns only the public-safe column list'
);
select ok(
  not exists (
    select 1 from unnest((select proargnames from pg_proc
                          where oid = 'public.get_public_bookmark(uuid)'::regprocedure)) a
    where a in ('user_id', 'url', 'pdf_path', 'status', 'error_message', 'progress',
                'archived', 'read_at', 'is_public', 'translated_content_md', 'url_normalized')
  ),
  'get_public_bookmark exposes no private columns'
);
select is(
  (select prosecdef from pg_proc where oid = 'public.get_public_bookmark(uuid)'::regprocedure),
  true, 'get_public_bookmark is security definer'
);
select ok(
  has_function_privilege('anon', 'public.get_public_bookmark(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.get_public_bookmark(uuid)', 'execute'),
  'get_public_bookmark is executable by anon and authenticated'
);
select function_returns('public', 'get_public_bookmark', array['uuid'], 'setof record');

select * from finish();
rollback;
