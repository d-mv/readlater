-- Inventory: the exact set of DB objects the migrations define. A new table,
-- function, trigger or policy fails here until it is added to this list —
-- and given tests in the matching file (see README.md checklist).
begin;
\ir _helpers.psql
select plan(9);

select tables_are('public',
  array['bookmarks', 'tags', 'bookmark_tags', 'bookmark_deletions', 'rate_limits']);

select functions_are('public', array[
  'get_public_bookmark',
  'bookmarks_touch_updated_at',
  'bookmark_tags_touch_bookmark',
  'bookmarks_record_deletion',
  'bookmarks_reset_retry',
  'bump_rate_limit_for_user',
  'bump_rate_limit',
  'list_orphaned_storage_objects'
]);

select triggers_are('public', 'bookmarks',
  array['bookmarks_touch_updated_at', 'bookmarks_record_deletion', 'bookmarks_reset_retry']);
select triggers_are('public', 'bookmark_tags', array['bookmark_tags_touch_bookmark']);
select triggers_are('public', 'tags', array[]::name[]);
select triggers_are('public', 'bookmark_deletions', array[]::name[]);

select is(
  (select array_agg(c.relname::text order by c.relname) from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and not c.relrowsecurity),
  null, 'RLS is enabled on every public table'
);

select is(
  (select array_agg(tablename || ': ' || policyname order by tablename, policyname)
   from pg_policies where schemaname = 'public'),
  array['bookmark_deletions: owner read', 'bookmark_tags: owner access',
        'bookmarks: owner access', 'tags: owner access']::text[],
  'public policies'
);

select indexes_are('public', 'bookmarks', array[
  'bookmarks_pkey', 'bookmarks_url_normalized_uniq', 'bookmarks_replica_identity_idx',
  'bookmarks_search_idx', 'bookmarks_user_updated_idx', 'bookmarks_pending_due_idx',
  'bookmarks_user_created_id_idx'
]);

select * from finish();
rollback;
