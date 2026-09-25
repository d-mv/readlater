-- Flattened initial schema for Read Later
-- Consolidates all migrations into a single bootstrap migration.

-- 1. Bookmarks table
create table bookmarks (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id),
  url                   text,
  url_normalized        text generated always as (lower(regexp_replace(url, '/+$', ''))) stored,
  type                  text not null check (type in ('article', 'youtube', 'note', 'pdf')),
  status                text not null default 'pending'
                          check (status in ('pending', 'processing', 'ready', 'failed')),
  title                 text,
  author                text,
  excerpt               text,
  content_md            text,
  translated_content_md text,
  translated_lang       text,
  thumbnail_url         text,
  youtube_video_id      text,
  content_edited        boolean not null default false,
  word_count            int,
  reading_time          int,
  is_public             boolean not null default false,
  pdf_path              text,
  pdf_parsed            boolean not null default false,
  view_mode             text check (view_mode in ('markdown', 'original')),
  progress              double precision default 0,
  search_vector         tsvector generated always as (
                          setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
                          setweight(to_tsvector('english', coalesce(content_md, '')), 'B')
                        ) stored,
  archived              boolean not null default false,
  read_at               timestamptz,
  error_message         text,
  created_at            timestamptz not null default now(),
  processed_at          timestamptz,

  constraint bookmarks_url_required_unless_note check (type in ('note', 'pdf') or url is not null),
  constraint bookmarks_pdf_path_requires_type check (pdf_path is null or type = 'pdf')
);

-- Indexes on bookmarks
create index bookmarks_status_idx on bookmarks (status) where status = 'pending';
create index bookmarks_user_created_idx on bookmarks (user_id, created_at desc);
create index bookmarks_search_idx on bookmarks using gin(search_vector);
create unique index bookmarks_url_normalized_uniq on bookmarks (url_normalized);

-- Replica identity for Realtime: DELETE events must carry user_id so Realtime
-- can evaluate the "owner access" RLS policy (the default identity is only the
-- primary key). Not REPLICA IDENTITY FULL: FULL requires the publication's
-- column list (below) to cover every column, which it deliberately doesn't,
-- and every DELETE then fails with 42P10. A covering unique index on
-- (id, user_id) is exactly what's needed.
create unique index bookmarks_replica_identity_idx on bookmarks (id, user_id);
alter table bookmarks replica identity using index bookmarks_replica_identity_idx;

-- RLS for bookmarks
alter table bookmarks enable row level security;
create policy "owner access" on bookmarks
  for all using (auth.uid() = user_id);

-- 2. Tags & Bookmark_Tags relational tables
create table tags (
  id    uuid primary key default gen_random_uuid(),
  name  text unique not null,
  color text default '#888888'
);

create table bookmark_tags (
  bookmark_id uuid not null references bookmarks(id) on delete cascade,
  tag_id      uuid not null references tags(id) on delete cascade,
  primary key (bookmark_id, tag_id)
);

create index bookmark_tags_tag_idx on bookmark_tags (tag_id);

-- RLS & Grants for tags & bookmark_tags
alter table tags enable row level security;
alter table bookmark_tags enable row level security;

create policy "authenticated only" on tags
  for all using (auth.role() = 'authenticated');

create policy "authenticated only" on bookmark_tags
  for all using (auth.role() = 'authenticated');

grant select, insert, update, delete on tags, bookmark_tags to authenticated;

-- 3. Public sharing RPC function
-- Returns public-safe columns only: no user_id, pdf_path (private storage
-- path), url, status, error_message, progress, archived/read flags or cached
-- translation. security definer + exact-id match, not a table policy, so the
-- anon key can't enumerate public rows.
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

-- 4. Storage buckets & policies
-- bookmark-assets: public bucket for YouTube thumbnails
insert into storage.buckets (id, name, public)
values ('bookmark-assets', 'bookmark-assets', true)
on conflict (id) do nothing;

-- bookmark-pdfs: private bucket for uploaded PDF files
insert into storage.buckets (id, name, public, file_size_limit)
values ('bookmark-pdfs', 'bookmark-pdfs', false, 20971520)
on conflict (id) do nothing;

create policy "owner read own pdfs" on storage.objects
  for select using (bucket_id = 'bookmark-pdfs' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "owner write own pdfs" on storage.objects
  for insert with check (bucket_id = 'bookmark-pdfs' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "owner delete own pdfs" on storage.objects
  for delete using (bucket_id = 'bookmark-pdfs' and (storage.foldername(name))[1] = auth.uid()::text);

-- 5. Realtime
-- Stream bookmark row changes to the app so the reading list stays live
-- without polling. The explicit column list omits the large text columns
-- (content_md, translated_content_md) and the generated search_vector: the
-- reader fetches the body on open, the list only needs metadata. user_id is
-- included so Realtime can apply the RLS policy to the stream.
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
