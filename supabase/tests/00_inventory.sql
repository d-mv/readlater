-- Inventory: the exact set of DB objects the migrations define. A new table,
-- function, trigger or policy fails here until it is added to this list —
-- and given tests in the matching file (see README.md checklist).
begin;
\ir _helpers.psql
select plan(12);

select tables_are('public',
  array['bookmarks', 'tags', 'bookmark_tags', 'bookmark_deletions', 'rate_limits', 'capture_keys']);

select functions_are('public', array[
  'get_public_bookmark',
  'bookmarks_touch_updated_at',
  'bookmark_tags_touch_bookmark',
  'tags_touch_bookmarks',
  'bookmarks_record_deletion',
  'bookmarks_reset_retry',
  'bump_rate_limit_for_user',
  'bump_rate_limit',
  'list_orphaned_storage_objects',
  'rate_limit_for',
  'rotate_capture_key'
]);

select triggers_are('public', 'bookmarks',
  array['bookmarks_touch_updated_at', 'bookmarks_record_deletion', 'bookmarks_reset_retry']);
select triggers_are('public', 'bookmark_tags', array['bookmark_tags_touch_bookmark']);
select triggers_are('public', 'tags', array['tags_touch_bookmarks']);
select triggers_are('public', 'bookmark_deletions', array[]::name[]);
select triggers_are('public', 'capture_keys', array[]::name[]);

select is(
  (select array_agg(c.relname::text order by c.relname) from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and not c.relrowsecurity),
  null, 'RLS is enabled on every public table'
);

select is(
  (select array_agg(tablename || ': ' || policyname order by tablename, policyname)
   from pg_policies where schemaname = 'public'),
  array['bookmark_deletions: owner read', 'bookmark_tags: owner access',
        'bookmarks: owner access', 'capture_keys: owner read', 'tags: owner access']::text[],
  'public policies'
);

-- Exact table privileges of the client roles (see the minimal_table_grants
-- migration). A new table fails this until its grants are decided here —
-- Supabase's defaults would hand anon/authenticated everything.
select is(
  (select array_agg(format('%s: %s: %s', table_name, grantee, privs) order by table_name, grantee)
   from (select table_name, grantee,
                string_agg(privilege_type, ',' order by privilege_type) as privs
         from information_schema.role_table_grants
         where table_schema = 'public' and grantee in ('anon', 'authenticated')
         group by table_name, grantee) g),
  array['bookmark_deletions: authenticated: SELECT',
        'bookmark_tags: authenticated: DELETE,INSERT,SELECT,UPDATE',
        'bookmarks: authenticated: DELETE,INSERT,SELECT,UPDATE',
        'tags: authenticated: INSERT,SELECT,UPDATE']::text[],
  'anon holds no table privileges; authenticated only what the app uses'
);

-- Column-only privileges (granted per column, with no table-level grant of
-- the same privilege): capture_keys exposes its dates, never key_hash.
select is(
  (select array_agg(format('%s.%s: %s: %s', table_name, column_name, grantee, privilege_type)
                    order by table_name, column_name, grantee, privilege_type)
   from information_schema.column_privileges cp
   where table_schema = 'public' and grantee in ('anon', 'authenticated')
     and not exists (select 1 from information_schema.role_table_grants t
                     where t.table_schema = 'public' and t.table_name = cp.table_name
                       and t.grantee = cp.grantee and t.privilege_type = cp.privilege_type)),
  array['capture_keys.created_at: authenticated: SELECT',
        'capture_keys.last_used_at: authenticated: SELECT']::text[],
  'column-level grants: only capture_keys'' dates, to authenticated'
);

select indexes_are('public', 'bookmarks', array[
  'bookmarks_pkey', 'bookmarks_user_url_normalized_uniq', 'bookmarks_replica_identity_idx',
  'bookmarks_search_idx', 'bookmarks_user_updated_idx', 'bookmarks_pending_due_idx',
  'bookmarks_user_created_id_idx'
]);

select * from finish();
rollback;
