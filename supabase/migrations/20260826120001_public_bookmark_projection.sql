-- Narrow get_public_bookmark to public-safe columns only.
--
-- The previous `returns setof bookmarks` / `select *` handed every column of
-- a shared bookmark to unauthenticated callers, including owner-internal data:
-- user_id, pdf_path (a private storage path), error_message, progress, the raw
-- url, processing status, archived/read flags, and any cached translation.
-- The public reader only needs what it renders.

drop function if exists get_public_bookmark(uuid);

create function get_public_bookmark(bookmark_id uuid)
returns table (
  id               uuid,
  type             text,
  title            text,
  author           text,
  excerpt          text,
  content_md       text,
  thumbnail_url    text,
  youtube_video_id text,
  word_count       int,
  reading_time     int,
  created_at       timestamptz
)
language sql
security definer
set search_path = public
as $$
  select id, type, title, author, excerpt, content_md, thumbnail_url,
         youtube_video_id, word_count, reading_time, created_at
  from bookmarks
  where id = bookmark_id and is_public = true;
$$;

grant execute on function get_public_bookmark(uuid) to anon, authenticated;
