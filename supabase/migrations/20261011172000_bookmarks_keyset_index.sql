-- The reading list pages by keyset on (created_at, id), newest first:
--   order by created_at desc, id desc
--   where created_at < $at or (created_at = $at and id < $id)
-- created_at alone isn't unique — an import stamps a whole batch with the
-- same instant — so paging on it skipped the rest of a batch at a page
-- boundary. RLS adds `user_id = auth.uid()`, hence the leading user_id.
create index bookmarks_user_created_id_idx on bookmarks (user_id, created_at desc, id desc);

-- (user_id, created_at desc) is a prefix of the new index, which serves
-- every query the old one did.
drop index bookmarks_user_created_idx;
