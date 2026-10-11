-- Delta sync for the reading list: the app keeps a local copy of the list and,
-- on each session, asks only for rows changed (updated_at) or deleted
-- (bookmark_deletions tombstones) since its last sync watermark.

-- 1. updated_at — bumped on every row change, and on tag attach/detach so the
-- embedded tags in the list projection stay in step.
alter table bookmarks add column updated_at timestamptz not null default now();
update bookmarks set updated_at = coalesce(processed_at, created_at);

create index bookmarks_user_updated_idx on bookmarks (user_id, updated_at);

create function bookmarks_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger bookmarks_touch_updated_at
  before update on bookmarks
  for each row execute function bookmarks_touch_updated_at();

-- security definer: bookmark_tags writes are allowed to any authenticated user,
-- but the touched bookmark is owner-RLS-protected. The update only bumps the
-- timestamp of the exact bookmark_id in the changed join row.
create function bookmark_tags_touch_bookmark()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update bookmarks set updated_at = now()
    where id = coalesce(new.bookmark_id, old.bookmark_id);
  return null;
end;
$$;

create trigger bookmark_tags_touch_bookmark
  after insert or delete on bookmark_tags
  for each row execute function bookmark_tags_touch_bookmark();

-- 2. Delete tombstones. Kept indefinitely: one tiny row per delete is nothing
-- at personal-library scale, and it means a device that stayed offline for any
-- length of time still learns about every delete.
create table bookmark_deletions (
  bookmark_id uuid primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  deleted_at  timestamptz not null default now()
);

create index bookmark_deletions_user_deleted_idx on bookmark_deletions (user_id, deleted_at);

alter table bookmark_deletions enable row level security;
create policy "owner read" on bookmark_deletions
  for select using (auth.uid() = user_id);
grant select on bookmark_deletions to authenticated;

-- security definer: clients only read tombstones; the trigger writes them.
create function bookmarks_record_deletion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into bookmark_deletions (bookmark_id, user_id)
    values (old.id, old.user_id)
    on conflict (bookmark_id) do update set deleted_at = excluded.deleted_at;
  return null;
end;
$$;

create trigger bookmarks_record_deletion
  after delete on bookmarks
  for each row execute function bookmarks_record_deletion();

-- 3. Carry updated_at in Realtime payloads too. The publication's column list
-- can only be changed by dropping and re-adding the table.
alter publication supabase_realtime drop table public.bookmarks;
alter publication supabase_realtime add table public.bookmarks (
  id, user_id, url, type, status, title, author, excerpt, translated_lang,
  thumbnail_url, youtube_video_id, content_edited, word_count, reading_time,
  is_public, pdf_path, pdf_parsed, view_mode, progress, archived, read_at,
  error_message, created_at, processed_at, updated_at
);
