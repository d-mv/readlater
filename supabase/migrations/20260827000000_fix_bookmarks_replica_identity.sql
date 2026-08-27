-- Fix 42P10 ("cannot delete from table \"bookmarks\": column list used by
-- the publication does not cover the replica identity").
--
-- REPLICA IDENTITY FULL means the identity covers every column, so Postgres
-- requires the supabase_realtime publication's column list to also cover
-- every column -- but that list deliberately omits content_md,
-- translated_content_md and search_vector, so every DELETE was rejected.
--
-- Realtime only needs id + user_id on DELETE (to evaluate the "owner
-- access" RLS policy), so use a covering unique index for the replica
-- identity instead of FULL -- narrow enough to satisfy the publication's
-- existing column list, which already includes both columns.

create unique index bookmarks_replica_identity_idx on public.bookmarks (id, user_id);

alter table public.bookmarks replica identity using index bookmarks_replica_identity_idx;
