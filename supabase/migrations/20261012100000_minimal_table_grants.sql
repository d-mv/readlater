-- Minimal table privileges for the client roles.
--
-- Supabase's default privileges hand anon and authenticated every privilege
-- (incl. TRUNCATE, TRIGGER, REFERENCES) on each new public table. RLS kept
-- the rows safe, but the grants should say what clients may do:
--
--   anon           nothing on any table. The public view reads through
--                  get_public_bookmark(), which is security definer (runs as
--                  its owner), so it needs no table privileges.
--   authenticated  what the app and the RLS-scoped edge functions use:
--     bookmarks           select / insert / update / delete
--     tags                select / insert / update — upsert on (user_id, name)
--                         with ON CONFLICT DO UPDATE; nothing deletes a tag
--     bookmark_tags       select / insert / update / delete — upsert on
--                         (bookmark_id, tag_id), detach deletes
--     bookmark_deletions  select — tombstones are written by the
--                         bookmarks_record_deletion trigger (security definer)
--     rate_limits         nothing (already revoked; RPCs only)
--
-- service_role is left as is: it bypasses RLS and is server-side only.
-- 00_inventory.sql pins these exact privileges per role and table.

revoke all on bookmarks, tags, bookmark_tags, bookmark_deletions, rate_limits
  from anon, authenticated;

grant select, insert, update, delete on bookmarks to authenticated;
grant select, insert, update on tags to authenticated;
grant select, insert, update, delete on bookmark_tags to authenticated;
grant select on bookmark_deletions to authenticated;
