-- bookmarks: check constraints, column defaults, url_normalized (generated +
-- unique index), indexes, replica identity.
begin;
\ir _helpers.psql
select plan(47);

-- ─── bookmarks_url_http_only ───────────────────────────────────────────────
select tests.authenticate_as('00000000-0000-0000-0000-00000000000a');

select throws_ok(
  $$insert into bookmarks (url, type, user_id) values ('javascript:alert(1)', 'article', auth.uid())$$,
  '23514', null, 'javascript: URL rejected'
);
select throws_ok(
  $$insert into bookmarks (url, type, user_id) values ('JavaScript:alert(1)', 'article', auth.uid())$$,
  '23514', null, 'mixed-case javascript: URL rejected'
);
select throws_ok(
  $$insert into bookmarks (url, type, user_id) values ('data:text/html,<script>x</script>', 'article', auth.uid())$$,
  '23514', null, 'data: URL rejected'
);
select throws_ok(
  $$insert into bookmarks (url, type, user_id) values ('ftp://x.example/a', 'article', auth.uid())$$,
  '23514', null, 'ftp: URL rejected'
);
select throws_ok(
  $$insert into bookmarks (url, type, user_id) values (' https://x.example/lead-space', 'article', auth.uid())$$,
  '23514', null, 'URL must start with the scheme (leading space rejected)'
);
select lives_ok(
  $$insert into bookmarks (url, type, user_id) values ('http://x.example/plain', 'article', auth.uid())$$,
  'http URL accepted'
);
select lives_ok(
  $$insert into bookmarks (url, type, user_id) values ('HTTPS://X.example/Upper', 'article', auth.uid())$$,
  'https URL accepted case-insensitively'
);
select lives_ok(
  $$insert into bookmarks (url, type, user_id, status) values (null, 'note', auth.uid(), 'ready')$$,
  'null URL accepted for a note'
);
select throws_ok(
  $$update bookmarks set url = 'javascript:alert(1)' where url = 'http://x.example/plain'$$,
  '23514', null, 'updating to a javascript: URL rejected'
);

-- ─── bookmarks_url_required_unless_note ────────────────────────────────────
select throws_ok(
  $$insert into bookmarks (url, type, user_id) values (null, 'article', auth.uid())$$,
  '23514', null, 'article requires a URL'
);
select throws_ok(
  $$insert into bookmarks (url, type, user_id) values (null, 'youtube', auth.uid())$$,
  '23514', null, 'youtube requires a URL'
);
select lives_ok(
  $$insert into bookmarks (url, type, user_id, status) values (null, 'pdf', auth.uid(), 'ready')$$,
  'pdf may omit the URL'
);

-- ─── bookmarks_pdf_path_requires_type ──────────────────────────────────────
select throws_ok(
  $$insert into bookmarks (url, type, user_id, pdf_path) values ('https://x.example/p', 'article', auth.uid(), 'a/b.pdf')$$,
  '23514', null, 'pdf_path only allowed on type = pdf'
);
select lives_ok(
  $$insert into bookmarks (type, user_id, pdf_path, status) values ('pdf', auth.uid(), auth.uid()::text || '/f.pdf', 'ready')$$,
  'pdf_path allowed on a pdf'
);

-- ─── enum-like checks ──────────────────────────────────────────────────────
select throws_ok(
  $$insert into bookmarks (url, type, user_id) values ('https://x.example/t', 'video', auth.uid())$$,
  '23514', null, 'unknown type rejected'
);
select throws_ok(
  $$insert into bookmarks (url, type, user_id, status) values ('https://x.example/s', 'article', auth.uid(), 'done')$$,
  '23514', null, 'unknown status rejected'
);
select throws_ok(
  $$insert into bookmarks (url, type, user_id, view_mode) values ('https://x.example/v', 'article', auth.uid(), 'html')$$,
  '23514', null, 'unknown view_mode rejected'
);
select lives_ok(
  $$insert into bookmarks (url, type, user_id, view_mode) values ('https://x.example/v2', 'article', auth.uid(), 'original')$$,
  'view_mode original accepted'
);
select throws_ok(
  $$insert into bookmarks (url, type) values ('https://x.example/nouser', 'article')$$,
  '42501', null, 'insert without user_id refused (no default on bookmarks; RLS with check)'
);

-- ─── defaults ──────────────────────────────────────────────────────────────
insert into bookmarks (id, url, type, user_id)
values ('00000000-0000-0000-0000-0000000000d1', 'https://x.example/defaults', 'article', auth.uid());
select results_eq(
  $$select status, is_public, archived, content_edited, pdf_parsed, progress, attempts,
           next_attempt_at is null, created_at = now(), updated_at = now()
    from bookmarks where id = '00000000-0000-0000-0000-0000000000d1'$$,
  $$values ('pending'::text, false, false, false, false, 0::double precision, 0, true, true, true)$$,
  'column defaults on insert'
);

-- ─── url_normalized ────────────────────────────────────────────────────────
insert into bookmarks (id, url, type, user_id)
values ('00000000-0000-0000-0000-0000000000e1', 'https://Example.COM/Path/To///', 'article', auth.uid());
select is(
  (select url_normalized from bookmarks where id = '00000000-0000-0000-0000-0000000000e1'),
  'https://example.com/Path/To',
  'url_normalized lowercases the scheme and host only, and strips trailing slashes'
);
select is(
  (select url_normalized from bookmarks where url is null limit 1),
  null, 'url_normalized is null when url is null'
);
select throws_ok(
  $$insert into bookmarks (url, type, user_id) values ('https://example.com/Path/To', 'article', auth.uid())$$,
  '23505', null, 'same normalized URL rejected for the same user (bookmarks_user_url_normalized_uniq)'
);
select throws_ok(
  $$insert into bookmarks (url, type, user_id) values ('HTTPS://EXAMPLE.COM/Path/To/', 'article', auth.uid())$$,
  '23505', null, 'scheme/host case and trailing-slash variant counts as a duplicate'
);
-- Paths and queries are case-sensitive (short links, video ids): differing
-- only there is a different page.
select lives_ok(
  $$insert into bookmarks (url, type, user_id) values ('https://example.com/path/to', 'article', auth.uid())$$,
  'a path differing only in case is a different URL'
);
select lives_ok(
  $$insert into bookmarks (url, type, user_id) values ('https://bit.ly/AbC', 'article', auth.uid()),
                                                      ('https://bit.ly/abc', 'article', auth.uid())$$,
  'short links differing only in case are both kept'
);
select is(
  (select url_normalized from bookmarks where url = 'https://bit.ly/AbC'),
  'https://bit.ly/AbC', 'the path keeps its case'
);
insert into bookmarks (url, type, user_id)
values ('HTTPS://Example.COM:8080/Q?Id=AbC', 'article', auth.uid());
select is(
  (select url_normalized from bookmarks where url = 'HTTPS://Example.COM:8080/Q?Id=AbC'),
  'https://example.com:8080/Q?Id=AbC', 'the port is kept and the query keeps its case'
);
select lives_ok(
  $$insert into bookmarks (url, type, user_id) values ('https://example.com/path/to?x=1', 'article', auth.uid())$$,
  'query string makes a distinct normalized URL'
);
select lives_ok(
  $$insert into bookmarks (type, user_id, status) values ('note', auth.uid(), 'ready'), ('note', auth.uid(), 'ready')$$,
  'many URL-less notes do not collide (null is distinct)'
);
select throws_ok(
  $$update bookmarks set url_normalized = 'x' where id = '00000000-0000-0000-0000-0000000000e1'$$,
  '428C9', null, 'url_normalized cannot be written directly'
);

-- Uniqueness is per user (user_id, url_normalized): B can save a URL A
-- already saved, and B's own duplicate is still refused.
select tests.authenticate_as('00000000-0000-0000-0000-00000000000b');
select lives_ok(
  $$insert into bookmarks (url, type, user_id) values ('https://example.com/path/to', 'article', auth.uid())$$,
  'another user can save a URL A already saved (uniqueness is per user)'
);
select throws_ok(
  $$insert into bookmarks (url, type, user_id) values ('https://EXAMPLE.com/path/to/', 'article', auth.uid())$$,
  '23505', null, 'B''s own duplicate is still rejected'
);
reset role;
select is(
  (select count(*)::int from bookmarks where url_normalized = 'https://example.com/path/to'),
  2, 'one row per user for the same normalized URL'
);

-- ─── schema shape ──────────────────────────────────────────────────────────
select col_not_null('public', 'bookmarks', 'user_id', 'bookmarks.user_id is not null');
select col_is_pk('public', 'bookmarks', 'id', 'bookmarks.id is the primary key');
select fk_ok('public', 'bookmarks', 'user_id', 'auth', 'users', 'id');
select has_check('public', 'bookmarks', 'bookmarks has check constraints');
select ok(
  exists (select 1 from pg_constraint
          where conrelid = 'public.bookmarks'::regclass and conname = 'bookmarks_url_http_only'),
  'bookmarks_url_http_only exists'
);
select index_is_unique('public', 'bookmarks', 'bookmarks_user_url_normalized_uniq');
select has_index('public', 'bookmarks', 'bookmarks_user_url_normalized_uniq',
  array['user_id', 'url_normalized'], 'URL uniqueness index is on (user_id, url_normalized)');
select index_is_unique('public', 'bookmarks', 'bookmarks_replica_identity_idx');
select has_index('public', 'bookmarks', 'bookmarks_search_idx', 'GIN index on search_vector');
select has_index('public', 'bookmarks', 'bookmarks_user_updated_idx', 'delta-sync index (user_id, updated_at)');
select has_index('public', 'bookmarks', 'bookmarks_user_created_id_idx', 'keyset index (user_id, created_at desc, id desc)');
select has_index('public', 'bookmarks', 'bookmarks_pending_due_idx', 'worker queue partial index');
select is(
  (select relreplident::text from pg_class where oid = 'public.bookmarks'::regclass),
  'i', 'bookmarks replica identity uses an index (carries user_id on DELETE)'
);

select * from finish();
rollback;
