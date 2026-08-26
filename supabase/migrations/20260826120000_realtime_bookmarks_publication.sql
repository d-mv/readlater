-- Stream bookmark row changes to the app so the reading list stays live
-- without the client polling the REST API every few seconds.
--
-- The publication uses an explicit column list that deliberately omits the
-- large text columns (content_md, translated_content_md) and the generated
-- tsvector (search_vector): the reader fetches the body on open, and the
-- list only ever needs metadata. user_id is included so Realtime can apply
-- the table's RLS policy ("owner access": auth.uid() = user_id) to the
-- stream.

-- REPLICA IDENTITY FULL is required for Realtime to evaluate the RLS policy
-- on DELETE events (the default identity only carries the primary key, which
-- is not enough to check user_id). Write volume on this table is low, so the
-- extra WAL is negligible.
alter table public.bookmarks replica identity full;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'bookmarks'
  ) then
    execute $sql$
      alter publication supabase_realtime add table public.bookmarks (
        id, user_id, url, type, status, title, author, excerpt, translated_lang,
        thumbnail_url, youtube_video_id, content_edited, word_count, reading_time,
        is_public, pdf_path, pdf_parsed, view_mode, progress, archived, read_at,
        error_message, created_at, processed_at
      )
    $sql$;
  end if;
end $$;
