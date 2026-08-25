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
create or replace function get_public_bookmark(bookmark_id uuid)
returns setof bookmarks
language sql
security definer
set search_path = public
as $$
  select * from bookmarks where id = bookmark_id and is_public = true;
$$;

grant execute on function get_public_bookmark(uuid) to anon;

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
