-- Delta sync sees tag changes: renaming or recolouring a tag, and re-pointing
-- a bookmark_tags row, bump the affected bookmarks' updated_at.
-- Deleting an auth user removes their bookmarks (no FK error).
begin;
\ir _helpers.psql
select plan(10);

insert into bookmarks (id, user_id, url, type, status)
values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a',
   'https://a.example/1', 'article', 'ready'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-00000000000a',
   'https://a.example/2', 'article', 'ready'),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-00000000000a',
   'https://a.example/3', 'article', 'ready'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000000b',
   'https://b.example/1', 'article', 'ready');
insert into tags (id, user_id, name, color)
values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000000a', 'news', '#111111'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-00000000000a', 'later', '#222222');
insert into bookmark_tags (bookmark_id, tag_id)
values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000f1'),
       ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000f1');

create function tests.age_bookmarks() returns void language sql as $$
  alter table public.bookmarks disable trigger bookmarks_touch_updated_at;
  update public.bookmarks set updated_at = '2000-01-01';
  alter table public.bookmarks enable trigger bookmarks_touch_updated_at;
$$;

-- ─── tag rename / recolour ─────────────────────────────────────────────────
select tests.age_bookmarks();
select tests.authenticate_as('00000000-0000-0000-0000-00000000000a');
update tags set name = 'headlines' where id = '00000000-0000-0000-0000-0000000000f1';
reset role;
select results_eq(
  $$select id, updated_at = now() from bookmarks where user_id = '00000000-0000-0000-0000-00000000000a' order by id$$,
  $$values ('00000000-0000-0000-0000-0000000000a1'::uuid, true),
           ('00000000-0000-0000-0000-0000000000a2'::uuid, true),
           ('00000000-0000-0000-0000-0000000000a3'::uuid, false)$$,
  'renaming a tag bumps exactly the bookmarks carrying it'
);

select tests.age_bookmarks();
select tests.authenticate_as('00000000-0000-0000-0000-00000000000a');
update tags set color = '#ff0000' where id = '00000000-0000-0000-0000-0000000000f1';
reset role;
select is(
  (select count(*)::int from bookmarks where updated_at = now()),
  2, 'recolouring a tag bumps the bookmarks carrying it'
);

select tests.age_bookmarks();
select tests.authenticate_as('00000000-0000-0000-0000-00000000000a');
update tags set name = name, color = color where id = '00000000-0000-0000-0000-0000000000f1';
reset role;
select is(
  (select count(*)::int from bookmarks where updated_at = now()),
  0, 'an update that changes nothing bumps nothing'
);

select tests.age_bookmarks();
select tests.authenticate_as('00000000-0000-0000-0000-00000000000a');
update tags set name = 'unused' where id = '00000000-0000-0000-0000-0000000000f2';
reset role;
select is(
  (select count(*)::int from bookmarks where updated_at = now()),
  0, 'renaming a tag nobody carries bumps nothing'
);

-- ─── bookmark_tags update ──────────────────────────────────────────────────
select tests.age_bookmarks();
select tests.authenticate_as('00000000-0000-0000-0000-00000000000a');
update bookmark_tags set bookmark_id = '00000000-0000-0000-0000-0000000000a3'
  where bookmark_id = '00000000-0000-0000-0000-0000000000a2';
reset role;
select results_eq(
  $$select id from bookmarks where updated_at = now() order by id$$,
  $$values ('00000000-0000-0000-0000-0000000000a2'::uuid),
           ('00000000-0000-0000-0000-0000000000a3'::uuid)$$,
  're-pointing a link bumps both the bookmark it left and the one it joined'
);

select tests.age_bookmarks();
select tests.authenticate_as('00000000-0000-0000-0000-00000000000a');
update bookmark_tags set tag_id = '00000000-0000-0000-0000-0000000000f2'
  where bookmark_id = '00000000-0000-0000-0000-0000000000a1';
reset role;
select results_eq(
  $$select id from bookmarks where updated_at = now()$$,
  $$values ('00000000-0000-0000-0000-0000000000a1'::uuid)$$,
  'swapping a link''s tag bumps its bookmark'
);

select has_trigger('public'::name, 'tags'::name, 'tags_touch_bookmarks'::name);
select is(
  (select prosecdef from pg_proc where oid = 'public.tags_touch_bookmarks()'::regprocedure),
  true, 'tags_touch_bookmarks is security definer'
);

-- ─── deleting a user ───────────────────────────────────────────────────────
select lives_ok(
  $$delete from auth.users where id = '00000000-0000-0000-0000-00000000000b'$$,
  'a user who still has bookmarks can be deleted'
);
select ok(
  not exists (select 1 from bookmarks where user_id = '00000000-0000-0000-0000-00000000000b')
  and not exists (select 1 from bookmark_deletions where user_id = '00000000-0000-0000-0000-00000000000b'),
  'their bookmarks go with them, leaving no tombstones'
);

select * from finish();
rollback;
