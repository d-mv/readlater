-- Public sharing via bookmark id as an unguessable token. Deliberately NOT a
-- blanket `for select using (is_public = true)` table policy: RLS is
-- row-level, not query-level, so that policy would let anyone holding the
-- anon key list every public bookmark with no id filter at all, defeating
-- the "id is the token" premise. Instead, a security definer RPC that only
-- ever returns a row for an exact id match. See docs/plans/read-later-new-capabilities.md §3.
alter table bookmarks
  add column is_public boolean not null default false;

-- No new write policy needed: the existing "owner access ... for all using
-- (auth.uid() = user_id)" policy already covers updating is_public, since
-- this is a single-owner app.

create or replace function get_public_bookmark(bookmark_id uuid)
returns setof bookmarks
language sql
security definer
set search_path = public
as $$
  select * from bookmarks where id = bookmark_id and is_public = true;
$$;

grant execute on function get_public_bookmark(uuid) to anon;
