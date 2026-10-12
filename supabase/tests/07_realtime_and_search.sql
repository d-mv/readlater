-- Realtime publication column list; search_vector / full-text search as the
-- app uses it (PostgREST textSearch type "websearch" → websearch_to_tsquery).
begin;
\ir _helpers.psql
select plan(19);

-- ─── realtime ──────────────────────────────────────────────────────────────
select ok(
  exists (select 1 from pg_publication_tables
          where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'bookmarks'),
  'bookmarks is in the supabase_realtime publication'
);
select is(
  (select array(select unnest(attnames) order by 1) from pg_publication_tables
   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'bookmarks'),
  array(select unnest(array[
    'id', 'user_id', 'url', 'type', 'status', 'title', 'author', 'excerpt', 'translated_lang',
    'thumbnail_url', 'youtube_video_id', 'content_edited', 'word_count', 'reading_time',
    'is_public', 'pdf_path', 'pdf_parsed', 'view_mode', 'progress', 'archived', 'read_at',
    'error_message', 'created_at', 'processed_at', 'updated_at']::name[]) order by 1),
  'realtime publishes exactly the list-metadata columns'
);
select ok(
  not exists (
    select 1 from pg_publication_tables, unnest(attnames) a
    where pubname = 'supabase_realtime' and tablename = 'bookmarks'
      and a in ('content_md', 'translated_content_md', 'search_vector', 'url_normalized')
  ),
  'realtime excludes body columns, search_vector and url_normalized'
);
select ok(
  (select array['id', 'user_id']::name[] <@ attnames from pg_publication_tables
   where pubname = 'supabase_realtime' and tablename = 'bookmarks'),
  'replica identity columns (id, user_id) are published (needed for DELETE + RLS)'
);
select ok(
  (select pubinsert and pubupdate and pubdelete from pg_publication where pubname = 'supabase_realtime'),
  'publication carries insert, update and delete'
);
select ok(
  not exists (select 1 from pg_publication_tables
              where pubname = 'supabase_realtime' and schemaname = 'public' and tablename <> 'bookmarks'),
  'no other public table is published'
);

-- ─── search_vector ─────────────────────────────────────────────────────────
insert into bookmarks (id, user_id, url, type, status, title, content_md)
values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a',
   'https://a.example/1', 'article', 'ready', 'Gardening basics', 'How to grow tomatoes in pots.'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-00000000000a',
   'https://a.example/2', 'article', 'ready', 'Weekend notes', 'Notes on gardening and running shoes.'),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-00000000000a',
   'https://a.example/3', 'article', 'ready', null, null),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000000b',
   'https://b.example/1', 'article', 'ready', 'Gardening for B', 'B''s private garden');

select is(
  (select search_vector from bookmarks where id = '00000000-0000-0000-0000-0000000000a3'),
  ''::tsvector, 'null title and body give an empty search_vector'
);
select ok(
  (select search_vector @@ to_tsquery('english', 'garden:A') from bookmarks
   where id = '00000000-0000-0000-0000-0000000000a1'),
  'title lexemes carry weight A'
);
select ok(
  (select search_vector @@ to_tsquery('english', 'tomato:B') from bookmarks
   where id = '00000000-0000-0000-0000-0000000000a1'),
  'body lexemes carry weight B'
);
select throws_ok(
  $$update bookmarks set search_vector = ''::tsvector$$,
  '428C9', null, 'search_vector cannot be written directly'
);

select tests.authenticate_as('00000000-0000-0000-0000-00000000000a');

select results_eq(
  $$select id from bookmarks where search_vector @@ websearch_to_tsquery('english', 'gardening') order by id$$,
  $$values ('00000000-0000-0000-0000-0000000000a1'::uuid), ('00000000-0000-0000-0000-0000000000a2'::uuid)$$,
  'matches title and body, own rows only (RLS still applies)'
);
select results_eq(
  $$select id from bookmarks where search_vector @@ websearch_to_tsquery('english', 'tomato')$$,
  $$values ('00000000-0000-0000-0000-0000000000a1'::uuid)$$,
  'stemming: "tomato" matches "tomatoes"'
);
select results_eq(
  $$select id from bookmarks where search_vector @@ websearch_to_tsquery('english', 'gardening -tomatoes')$$,
  $$values ('00000000-0000-0000-0000-0000000000a2'::uuid)$$,
  'websearch negation excludes rows'
);
select results_eq(
  $$select id from bookmarks where search_vector @@ websearch_to_tsquery('english', '"running shoes"')$$,
  $$values ('00000000-0000-0000-0000-0000000000a2'::uuid)$$,
  'websearch quoted phrase'
);
select is_empty(
  $$select id from bookmarks where search_vector @@ websearch_to_tsquery('english', '"shoes running"')$$,
  'phrase order matters'
);
select results_eq(
  $$select id from bookmarks where search_vector @@ websearch_to_tsquery('english', 'pots or shoes') order by id$$,
  $$values ('00000000-0000-0000-0000-0000000000a1'::uuid), ('00000000-0000-0000-0000-0000000000a2'::uuid)$$,
  'websearch "or"'
);
select results_eq(
  $$select id from bookmarks where search_vector @@ websearch_to_tsquery('english', 'gardening')
    order by ts_rank(search_vector, websearch_to_tsquery('english', 'gardening')) desc limit 1$$,
  $$values ('00000000-0000-0000-0000-0000000000a1'::uuid)$$,
  'a title match outranks a body match'
);

update bookmarks set content_md = 'Now about kayaks.' where id = '00000000-0000-0000-0000-0000000000a3';
select results_eq(
  $$select id from bookmarks where search_vector @@ websearch_to_tsquery('english', 'kayak')$$,
  $$values ('00000000-0000-0000-0000-0000000000a3'::uuid)$$,
  'search_vector is recomputed when content_md changes'
);
reset role;

-- PostgREST calls websearch_to_tsquery without a config: the default must
-- stem like the column's 'english' config, or app searches miss.
select is(
  websearch_to_tsquery('gardening')::text,
  websearch_to_tsquery('english', 'gardening')::text,
  'default_text_search_config matches the english search_vector'
);

select * from finish();
rollback;
