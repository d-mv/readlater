-- tags + bookmark_tags: per-user uniqueness, owner-only RLS, cross-user link
-- refusal, default user_id, and the bookmark_tags_touch_bookmark trigger.
begin;
\ir _helpers.psql
select plan(39);

insert into bookmarks (id, user_id, url, type, status, updated_at)
values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a',
   'https://a.example/1', 'article', 'ready', '2000-01-01'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-00000000000a',
   'https://a.example/2', 'article', 'ready', '2000-01-01'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000000b',
   'https://b.example/1', 'article', 'ready', '2000-01-01');
insert into tags (id, user_id, name)
values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000000a', 'shared-name'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-00000000000b', 'b-only');

-- ─── schema ────────────────────────────────────────────────────────────────
select col_not_null('public', 'tags', 'user_id', 'tags.user_id is not null');
select col_default_is('public', 'tags', 'user_id', 'auth.uid()', 'tags.user_id defaults to auth.uid()');
select col_default_is('public', 'tags', 'color', '#888888', 'tags.color defaults to #888888');
select ok(
  exists (select 1 from pg_constraint where conrelid = 'public.tags'::regclass
          and conname = 'tags_user_id_name_key' and contype = 'u'),
  'tags_user_id_name_key unique (user_id, name) exists'
);
select ok(
  not exists (select 1 from pg_constraint where conrelid = 'public.tags'::regclass
              and conname = 'tags_name_key'),
  'the old global tags_name_key is gone'
);
select col_is_pk('public', 'bookmark_tags', array['bookmark_id', 'tag_id'], 'bookmark_tags PK (bookmark_id, tag_id)');
select has_index('public', 'bookmark_tags', 'bookmark_tags_tag_idx', 'bookmark_tags.tag_id index');
select policies_are('public', 'tags', array['owner access']);
select policies_are('public', 'bookmark_tags', array['owner access']);
select policy_roles_are('public', 'tags', 'owner access', array['authenticated']);
select policy_roles_are('public', 'bookmark_tags', 'owner access', array['authenticated']);
select has_trigger('public'::name, 'bookmark_tags'::name, 'bookmark_tags_touch_bookmark'::name);
select is(
  (select prosecdef from pg_proc where oid = 'public.bookmark_tags_touch_bookmark()'::regprocedure),
  true, 'bookmark_tags_touch_bookmark is security definer'
);

-- ─── tags as user A ────────────────────────────────────────────────────────
select tests.authenticate_as('00000000-0000-0000-0000-00000000000a');

select results_eq('select id from tags', $$values ('00000000-0000-0000-0000-0000000000f1'::uuid)$$,
  'A sees only own tags');
select lives_ok(
  $$insert into tags (id, name) values ('00000000-0000-0000-0000-0000000000f3', 'a-second')$$,
  'A inserts a tag without user_id'
);
select is(
  (select user_id from tags where id = '00000000-0000-0000-0000-0000000000f3'),
  '00000000-0000-0000-0000-00000000000a'::uuid, 'user_id defaults to the caller'
);
select throws_ok(
  $$insert into tags (name) values ('shared-name')$$,
  '23505', null, 'duplicate tag name for the same user rejected'
);
select throws_ok(
  $$insert into tags (name, user_id) values ('forged', '00000000-0000-0000-0000-00000000000b')$$,
  '42501', null, 'A cannot create a tag owned by B'
);
select is_empty(
  $$update tags set name = 'hacked' where id = '00000000-0000-0000-0000-0000000000f2' returning 1$$,
  'A cannot rename B''s tag'
);
select is_empty(
  $$delete from tags where id = '00000000-0000-0000-0000-0000000000f2' returning 1$$,
  'A cannot delete B''s tag'
);
select throws_ok(
  $$update tags set user_id = '00000000-0000-0000-0000-00000000000b' where id = '00000000-0000-0000-0000-0000000000f3'$$,
  '42501', null, 'A cannot give a tag away to B'
);
-- upsert path the app uses: onConflict "user_id,name"
select lives_ok(
  $$insert into tags (name, color) values ('shared-name', '#ff0000')
    on conflict (user_id, name) do update set color = excluded.color$$,
  'upsert on (user_id, name) works for the app''s tag create path'
);

-- ─── bookmark_tags as user A ───────────────────────────────────────────────
select lives_ok(
  $$insert into bookmark_tags (bookmark_id, tag_id)
    values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000f1')$$,
  'A links own tag to own bookmark'
);
select is(
  (select updated_at from bookmarks where id = '00000000-0000-0000-0000-0000000000a1'),
  now(), 'attaching a tag bumps the bookmark''s updated_at'
);
select throws_ok(
  $$insert into bookmark_tags (bookmark_id, tag_id)
    values ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000f2')$$,
  '42501', null, 'A cannot attach B''s tag to own bookmark'
);
select throws_ok(
  $$insert into bookmark_tags (bookmark_id, tag_id)
    values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000f1')$$,
  '42501', null, 'A cannot attach own tag to B''s bookmark'
);
select throws_ok(
  $$update bookmark_tags set tag_id = '00000000-0000-0000-0000-0000000000f2'
    where bookmark_id = '00000000-0000-0000-0000-0000000000a1'$$,
  '42501', null, 'A cannot repoint a link at B''s tag'
);
reset role;

select is(
  (select updated_at from bookmarks where id = '00000000-0000-0000-0000-0000000000a2'),
  '2000-01-01'::timestamptz, 'a refused link does not bump the bookmark'
);
select is(
  (select updated_at from bookmarks where id = '00000000-0000-0000-0000-0000000000b1'),
  '2000-01-01'::timestamptz, 'A cannot bump B''s bookmark through the security-definer trigger'
);

-- Detach bumps too. Reset the timestamp first (trigger disabled for the fixture).
alter table bookmarks disable trigger bookmarks_touch_updated_at;
update bookmarks set updated_at = '2000-01-01' where id = '00000000-0000-0000-0000-0000000000a1';
alter table bookmarks enable trigger bookmarks_touch_updated_at;

select tests.authenticate_as('00000000-0000-0000-0000-00000000000a');
delete from bookmark_tags where bookmark_id = '00000000-0000-0000-0000-0000000000a1';
select is(
  (select updated_at from bookmarks where id = '00000000-0000-0000-0000-0000000000a1'),
  now(), 'detaching a tag bumps the bookmark''s updated_at'
);
reset role;

-- Deleting a tag cascades its links and bumps their bookmarks (delta sync).
insert into bookmark_tags (bookmark_id, tag_id)
values ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000f3');
alter table bookmarks disable trigger bookmarks_touch_updated_at;
update bookmarks set updated_at = '2000-01-01' where id = '00000000-0000-0000-0000-0000000000a2';
alter table bookmarks enable trigger bookmarks_touch_updated_at;

select tests.authenticate_as('00000000-0000-0000-0000-00000000000a');
delete from tags where id = '00000000-0000-0000-0000-0000000000f3';
select is_empty(
  $$select 1 from bookmark_tags where tag_id = '00000000-0000-0000-0000-0000000000f3'$$,
  'deleting a tag cascades to its links'
);
select is(
  (select updated_at from bookmarks where id = '00000000-0000-0000-0000-0000000000a2'),
  now(), 'deleting a tag bumps the bookmarks it was attached to'
);

-- ─── user B view ───────────────────────────────────────────────────────────
reset role;
insert into bookmark_tags (bookmark_id, tag_id)
values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000f1'),
       ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000f2');

select tests.authenticate_as('00000000-0000-0000-0000-00000000000b');
select results_eq('select tag_id from bookmark_tags',
  $$values ('00000000-0000-0000-0000-0000000000f2'::uuid)$$, 'B sees only own links');
select is_empty(
  $$delete from bookmark_tags where bookmark_id = '00000000-0000-0000-0000-0000000000a1' returning 1$$,
  'B cannot delete A''s links'
);
select lives_ok(
  $$insert into tags (name) values ('shared-name')$$,
  'B can use a tag name A already has (unique per user)'
);

-- ─── anon ──────────────────────────────────────────────────────────────────
select tests.authenticate_anon();
select is_empty('select 1 from tags', 'anon sees no tags');
select is_empty('select 1 from bookmark_tags', 'anon sees no links');
select throws_ok(
  $$insert into tags (name, user_id) values ('anon', '00000000-0000-0000-0000-00000000000a')$$,
  '42501', null, 'anon cannot insert tags'
);
reset role;

-- Deleting a bookmark cascades its links (trigger then finds no row to bump).
select lives_ok(
  $$delete from bookmarks where id = '00000000-0000-0000-0000-0000000000a1'$$,
  'deleting a tagged bookmark succeeds (links cascade)'
);

select * from finish();
rollback;
