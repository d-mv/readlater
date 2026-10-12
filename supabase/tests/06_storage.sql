-- Storage: buckets (privacy, size and MIME allow-lists), bookmark-pdfs
-- policies on storage.objects, list_orphaned_storage_objects().
--
-- Bucket size/MIME limits are enforced by the Storage API, not by Postgres,
-- so only their configured values are checked here.
begin;
\ir _helpers.psql
select plan(31);

-- ─── buckets ───────────────────────────────────────────────────────────────
select results_eq(
  $$select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'bookmark-pdfs'$$,
  $$values (false, 20971520::bigint, array['application/pdf'])$$,
  'bookmark-pdfs: private, 20 MiB, PDF only'
);
select results_eq(
  $$select public, allowed_mime_types from storage.buckets where id = 'bookmark-assets'$$,
  $$values (true, array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'])$$,
  'bookmark-assets: public, image types only'
);

-- ─── policies ──────────────────────────────────────────────────────────────
select policies_are('storage', 'objects',
  array['owner read own pdfs', 'owner write own pdfs', 'owner delete own pdfs']);
select policy_cmd_is('storage'::name, 'objects'::name, 'owner read own pdfs'::name, 'select'::text);
select policy_cmd_is('storage'::name, 'objects'::name, 'owner write own pdfs'::name, 'insert'::text);
select policy_cmd_is('storage'::name, 'objects'::name, 'owner delete own pdfs'::name, 'delete'::text);
select policy_roles_are('storage', 'objects', 'owner read own pdfs', array['authenticated']);
select policy_roles_are('storage', 'objects', 'owner write own pdfs', array['authenticated']);
select policy_roles_are('storage', 'objects', 'owner delete own pdfs', array['authenticated']);

insert into storage.objects (bucket_id, name, owner_id)
values ('bookmark-pdfs', '00000000-0000-0000-0000-00000000000b/b.pdf', '00000000-0000-0000-0000-00000000000b');

select tests.authenticate_as('00000000-0000-0000-0000-00000000000a');
select lives_ok(
  $$insert into storage.objects (bucket_id, name, owner_id)
    values ('bookmark-pdfs', '00000000-0000-0000-0000-00000000000a/a.pdf', auth.uid()::text)$$,
  'A uploads into own folder of bookmark-pdfs'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner_id)
    values ('bookmark-pdfs', '00000000-0000-0000-0000-00000000000b/evil.pdf', auth.uid()::text)$$,
  '42501', null, 'A cannot upload into B''s folder'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner_id)
    values ('bookmark-pdfs', 'root.pdf', auth.uid()::text)$$,
  '42501', null, 'A cannot upload outside any user folder'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner_id)
    values ('bookmark-assets', '00000000-0000-0000-0000-00000000000a/x.jpg', auth.uid()::text)$$,
  '42501', null, 'users cannot write bookmark-assets (worker/service role only)'
);
select results_eq(
  'select name from storage.objects',
  $$values ('00000000-0000-0000-0000-00000000000a/a.pdf'::text)$$,
  'A lists only own PDFs'
);
select is_empty(
  $$update storage.objects set name = '00000000-0000-0000-0000-00000000000a/moved.pdf'
    where name = '00000000-0000-0000-0000-00000000000b/b.pdf' returning 1$$,
  'A cannot update B''s object (no update policy)'
);

-- Direct deletes are guarded by storage.protect_delete; the Storage API sets
-- this flag, so set it too to reach the RLS policy.
set local storage.allow_delete_query = 'true';
select is_empty(
  $$delete from storage.objects where name = '00000000-0000-0000-0000-00000000000b/b.pdf' returning 1$$,
  'A cannot delete B''s PDF'
);
select results_eq(
  $$with d as (delete from storage.objects where name = '00000000-0000-0000-0000-00000000000a/a.pdf' returning 1)
    select count(*)::int from d$$,
  $$values (1)$$,
  'A deletes own PDF'
);

select tests.authenticate_anon();
select is_empty('select 1 from storage.objects', 'anon lists no objects');
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('bookmark-pdfs', 'anon/x.pdf')$$,
  '42501', null, 'anon cannot upload'
);
reset role;
set local storage.allow_delete_query = 'false';

-- ─── list_orphaned_storage_objects ─────────────────────────────────────────
delete from bookmarks;
insert into storage.buckets (id, name, public) values ('other', 'other', false);

insert into bookmarks (user_id, type, status, url, pdf_path, thumbnail_url, content_md)
values
  ('00000000-0000-0000-0000-00000000000a', 'pdf', 'ready', null,
   '00000000-0000-0000-0000-00000000000a/kept.pdf', null, null),
  ('00000000-0000-0000-0000-00000000000a', 'youtube', 'ready', 'https://youtube.com/watch?v=1', null,
   'https://p.supabase.co/storage/v1/object/public/bookmark-assets/youtube/thumb.jpg?v=2', null),
  ('00000000-0000-0000-0000-00000000000b', 'youtube', 'ready', 'https://youtube.com/watch?v=2', null,
   null, '![thumb](https://p.supabase.co/storage/v1/object/public/bookmark-assets/youtube/in-md.jpg)'),
  ('00000000-0000-0000-0000-00000000000b', 'article', 'ready', 'https://x.example/a', null,
   null, '![img](https://p.supabase.co/storage/v1/object/public/bookmark-assets/youtube/article-md.jpg)');

insert into storage.objects (bucket_id, name, created_at)
values
  ('bookmark-pdfs',   '00000000-0000-0000-0000-00000000000a/kept.pdf',   now() - interval '3 days'),
  ('bookmark-pdfs',   '00000000-0000-0000-0000-00000000000a/orphan.pdf', now() - interval '3 days'),
  ('bookmark-pdfs',   '00000000-0000-0000-0000-00000000000a/fresh.pdf',  now() - interval '1 hour'),
  ('bookmark-assets', 'youtube/thumb.jpg',       now() - interval '5 days'),
  ('bookmark-assets', 'youtube/in-md.jpg',       now() - interval '5 days'),
  ('bookmark-assets', 'youtube/article-md.jpg',  now() - interval '4 days'),
  ('bookmark-assets', 'youtube/orphan.jpg',      now() - interval '2 days'),
  ('bookmark-assets', 'thumb.jpg',               now() - interval '6 days'),
  ('other',           'whatever.bin',            now() - interval '9 days');

select tests.authenticate_service_role();
select results_eq(
  $$select bucket_id, name from list_orphaned_storage_objects()$$,
  $$values ('bookmark-assets'::text, 'thumb.jpg'::text),
           ('bookmark-assets', 'youtube/article-md.jpg'),
           ('bookmark-pdfs', '00000000-0000-0000-0000-00000000000a/orphan.pdf'),
           ('bookmark-assets', 'youtube/orphan.jpg')$$,
  'lists unreferenced objects older than a day, oldest first'
);
select ok(
  not exists (select 1 from list_orphaned_storage_objects() where name = '00000000-0000-0000-0000-00000000000a/kept.pdf'),
  'a PDF referenced by bookmarks.pdf_path is kept'
);
select ok(
  not exists (select 1 from list_orphaned_storage_objects() where name = 'youtube/thumb.jpg'),
  'an asset referenced by thumbnail_url (with query string) is kept'
);
select ok(
  not exists (select 1 from list_orphaned_storage_objects() where name = 'youtube/in-md.jpg'),
  'an asset referenced only by a youtube bookmark''s content_md is kept'
);
select ok(
  exists (select 1 from list_orphaned_storage_objects() where name = 'youtube/article-md.jpg'),
  'content_md references only count for youtube bookmarks'
);
select ok(
  exists (select 1 from list_orphaned_storage_objects() where name = 'thumb.jpg'),
  'a suffix match on a different path does not keep an object'
);
select ok(
  not exists (select 1 from list_orphaned_storage_objects() where bucket_id = 'other'),
  'objects in other buckets are never listed'
);
select ok(
  not exists (select 1 from list_orphaned_storage_objects() where name like '%fresh.pdf'),
  'objects younger than p_min_age (default 1 day) are skipped'
);
select ok(
  exists (select 1 from list_orphaned_storage_objects(interval '30 minutes') where name like '%fresh.pdf'),
  'a shorter p_min_age includes them'
);
select results_eq(
  $$select name from list_orphaned_storage_objects(interval '1 day', 2)$$,
  $$values ('thumb.jpg'::text), ('youtube/article-md.jpg')$$,
  'p_limit caps the result (oldest first)'
);
reset role;

select tests.authenticate_as('00000000-0000-0000-0000-00000000000a');
select throws_ok(
  $$select * from list_orphaned_storage_objects()$$, '42501', null,
  'authenticated cannot call list_orphaned_storage_objects'
);
reset role;
select tests.authenticate_anon();
select throws_ok(
  $$select * from list_orphaned_storage_objects()$$, '42501', null,
  'anon cannot call list_orphaned_storage_objects'
);
reset role;

select * from finish();
rollback;
